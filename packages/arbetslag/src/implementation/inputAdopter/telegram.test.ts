import { describe, it, expect, vi, afterEach } from "vitest";
import { TelegramInputAdopter, type Update } from "./telegram";
import { contentText } from "@/application/agent/history";

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
    expect(contentText(event!.content)).toBe("[wangwu]: 明天那个会议室订好了吗");
    expect(event!.sender).toBe("wangwu");
  });

  it("falls back to first_name when username missing", async () => {
    const event = await new TelegramInputAdopter().convert(
      makeUpdate({ from: { id: 1, first_name: "王五" } }),
    );
    expect(contentText(event!.content)).toBe("[王五]: 明天那个会议室订好了吗");
    expect(event!.sender).toBe("王五");
  });

  it("adds no prefix when the sender is unknown", async () => {
    const event = await new TelegramInputAdopter().convert(
      makeUpdate({ from: undefined }),
    );
    expect(contentText(event!.content)).toBe("明天那个会议室订好了吗");
    expect(event!.sender).toBeUndefined();
  });

  it("adds no <reply_to> block when the message has no reply info", async () => {
    const event = await new TelegramInputAdopter().convert(makeUpdate());
    expect(contentText(event!.content)).toBe("[wangwu]: 明天那个会议室订好了吗");
  });

  it("renders a <reply_to> block when the message quotes a text message", async () => {
    const event = await new TelegramInputAdopter().convert(
      makeUpdate({
        text: "昨天说的那件事呢",
        reply_to_message: {
          message_id: 7,
          chat: { id: 42 },
          from: { id: 2, username: "lisi" },
          text: "昨天我提到了会议室",
          date: 1699999000,
        },
      }),
    );
    expect(contentText(event!.content)).toBe(
      "[wangwu]: <reply_to sender=\"lisi\">\n昨天我提到了会议室\n</reply_to>\n昨天说的那件事呢",
    );
    expect(contentText(event!.content)).not.toContain("已截断");
  });

  it("truncates quoted originals longer than 200 characters", async () => {
    const longText = "长".repeat(250);
    const event = await new TelegramInputAdopter().convert(
      makeUpdate({
        reply_to_message: {
          message_id: 7,
          chat: { id: 42 },
          from: { id: 2, username: "lisi" },
          text: longText,
        },
      }),
    );
    expect(contentText(event!.content)).toBe(
      `[wangwu]: <reply_to sender="lisi">\n${"长".repeat(200)}（原文较长，已截断）\n</reply_to>\n明天那个会议室订好了吗`,
    );
  });

  it("renders a [sticker] marker with emoji when the message quotes a sticker", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const event = await new TelegramInputAdopter().convert(
      makeUpdate({
        text: "这是啥梗",
        reply_to_message: {
          message_id: 7,
          chat: { id: 42 },
          from: { id: 2, username: "lisi" },
          sticker: { emoji: "🎉" },
        },
      }),
    );
    expect(contentText(event!.content)).toBe(
      "[wangwu]: <reply_to sender=\"lisi\">\n[sticker 🎉]\n</reply_to>\n这是啥梗",
    );
    // 贴纸不下载：emoji 字段已完整刻画贴纸内容
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("re-inlines the largest quoted photo as an image part in the reply block", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      requested.push(url);
      if (url.includes("/getFile")) {
        const fileId = new URL(url).searchParams.get("file_id");
        return { json: async () => ({ ok: true, result: { file_path: `photos/${fileId}.jpg` } }) };
      }
      return { arrayBuffer: async () => new Uint8Array([7]).buffer };
    }));

    const event = await new TelegramInputAdopter("TOKEN123").convert(
      makeUpdate({
        text: "这张更好看",
        reply_to_message: {
          message_id: 7,
          chat: { id: 42 },
          from: { id: 2, username: "lisi" },
          photo: [
            { file_id: "quoted-small", file_unique_id: "u1", width: 90, height: 90 },
            { file_id: "quoted-large", file_unique_id: "u2", width: 1280, height: 960 },
          ],
        },
      }),
    );
    // 被引用图片取最大尺寸下载
    expect(requested.some((u) => u.includes("file_id=quoted-large"))).toBe(true);
    expect(requested.some((u) => u.includes("file_id=quoted-small"))).toBe(false);
    // 引用图紧跟 lead，当前文本在其后
    expect(event!.content).toEqual([
      { type: "text", text: "[wangwu]: <reply_to sender=\"lisi\">\n[photo]\n</reply_to>\n" },
      { type: "image", url: "data:image/jpeg;base64,Bw==" },
      { type: "text", text: "这张更好看" },
    ]);
  });

  it("falls back to a [photo] marker without image when the quoted photo download fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    const event = await new TelegramInputAdopter("TOKEN123").convert(
      makeUpdate({
        text: "这张更好看",
        reply_to_message: {
          message_id: 7,
          chat: { id: 42 },
          from: { id: 2, username: "lisi" },
          photo: [{ file_id: "quoted", file_unique_id: "u", width: 1, height: 1 }],
        },
      }),
    );
    expect(contentText(event!.content)).toBe(
      "[wangwu]: <reply_to sender=\"lisi\">\n[photo]\n</reply_to>\n这张更好看",
    );
  });

  it("keeps the quoted image and the current image as separate parts, quoted first", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/getFile")) {
        const fileId = new URL(url).searchParams.get("file_id");
        return { json: async () => ({ ok: true, result: { file_path: `photos/${fileId}.jpg` } }) };
      }
      // 用不同字节区分被引用图与当前图
      return { arrayBuffer: async () => new Uint8Array(url.includes("quoted-large") ? [7] : [9]).buffer };
    }));

    const event = await new TelegramInputAdopter("TOKEN123").convert(
      makeUpdate({
        text: "看这张图",
        reply_to_message: {
          message_id: 7,
          chat: { id: 42 },
          from: { id: 2, username: "lisi" },
          photo: [{ file_id: "quoted-large", file_unique_id: "u2", width: 1280, height: 960 }],
        },
        photo: [{ file_id: "large", file_unique_id: "u3", width: 1280, height: 960 }],
      }),
    );
    expect(event!.content).toEqual([
      { type: "text", text: "[wangwu]: <reply_to sender=\"lisi\">\n[photo]\n</reply_to>\n" },
      { type: "image", url: "data:image/jpeg;base64,Bw==" },
      { type: "text", text: "看这张图" },
      { type: "image", url: "data:image/jpeg;base64,CQ==" },
    ]);
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
        reply_to_message: {
          message_id: 7,
          chat: { id: 42 },
          from: { id: 2, username: "lisi" },
          text: "被引用的原话",
        },
        photo: [
          { file_id: "small", file_unique_id: "u1", width: 90, height: 90 },
          { file_id: "large", file_unique_id: "u2", width: 1280, height: 960 },
        ],
      }),
    );
    expect(event!.content).toEqual([
      { type: "text", text: "[wangwu]: <reply_to sender=\"lisi\">\n被引用的原话\n</reply_to>\n看这张图" },
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
      { type: "text", text: "[wangwu]: " },
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
    expect(contentText(event!.content)).toBe("[wangwu]: 明天那个会议室订好了吗");
  });
});
