import { describe, it, expect, vi, afterEach } from "vitest";
import { TelegramInputAdopter, type Update } from "./telegram";

function makeUpdate(overrides: Partial<NonNullable<Update["message"]>> = {}): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 42 },
      from: { id: 1, username: "wangwu", first_name: "王五" },
      date: 1700000000, // 固定时间戳，避免测试依赖运行时刻
      text: "明天那个会议室订好了吗",
      ...overrides,
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("TelegramInputAdopter", () => {
  it("uses username and falls back to first_name when username missing", async () => {
    const event = await new TelegramInputAdopter().convert(makeUpdate());
    expect(event).not.toBeNull();
    expect(event!.content).toBe("明天那个会议室订好了吗");
    expect(event!.sender).toBe("wangwu");
  });

  it("falls back to first_name when username missing", async () => {
    const event = await new TelegramInputAdopter().convert(
      makeUpdate({ from: { id: 1, first_name: "王五" } }),
    );
    expect(event!.content).toBe("明天那个会议室订好了吗");
    expect(event!.sender).toBe("王五");
  });

  it("returns null for updates without text or photo", async () => {
    const event = await new TelegramInputAdopter().convert(makeUpdate({ text: undefined }));
    expect(event).toBeNull();
  });

  it("downloads the largest photo and emits image + caption parts", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/getFile")) {
        return {
          json: async () => ({ ok: true, result: { file_path: "photos/a.jpg", mime_type: "image/jpeg" } }),
        };
      }
      expect(url).toBe("https://api.telegram.org/file/botTOKEN123/photos/a.jpg");
      return { arrayBuffer: async () => bytes.buffer };
    }));

    const event = await new TelegramInputAdopter("TOKEN123").convert(
      makeUpdate({
        text: "看这张图",
        photo: [
          { file_id: "small", file_unique_id: "u1", width: 90, height: 90 },
          { file_id: "large", file_unique_id: "u2", width: 1280, height: 960 },
        ],
      }),
    );
    expect(event!.content).toEqual([
      { type: "text", text: "看这张图" },
      { type: "image", url: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}` },
    ]);
  });

  it("emits an image-only message when the photo has no caption", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/getFile")) {
        return { json: async () => ({ ok: true, result: { file_path: "photos/a.jpg" } }) };
      }
      return { arrayBuffer: async () => new Uint8Array([9]).buffer };
    }));

    const event = await new TelegramInputAdopter("TOKEN123").convert(
      makeUpdate({ text: undefined, photo: [{ file_id: "p", file_unique_id: "u", width: 1, height: 1 }] }),
    );
    expect(event!.content).toEqual([
      { type: "image", url: "data:image/jpeg;base64,CQ==" },
    ]);
  });

  it("falls back to caption only when the photo download fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    const event = await new TelegramInputAdopter("TOKEN123").convert(
      makeUpdate({ photo: [{ file_id: "p", file_unique_id: "u", width: 1, height: 1 }] }),
    );
    expect(event!.content).toBe("明天那个会议室订好了吗");
  });
});
