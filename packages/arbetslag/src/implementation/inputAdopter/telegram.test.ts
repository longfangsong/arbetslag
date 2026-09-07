import { describe, it, expect } from "vitest";
import { TelegramInputAdopter, type Update } from "./telegram";

function makeUpdate(overrides: Partial<NonNullable<Update["message"]>> = {}): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: 42 },
      from: { id: 1, first_name: "王五" },
      date: 1700000000, // 固定时间戳，避免测试依赖运行时刻
      text: "明天那个会议室订好了吗",
      ...overrides,
    },
  };
}

describe("TelegramInputAdopter", () => {
  it("converts content to raw message text and sender to structured field", () => {
    const event = new TelegramInputAdopter().convert(makeUpdate());
    expect(event).not.toBeNull();
    expect(event!.content).toBe("明天那个会议室订好了吗");
    expect(event!.sender).toBe("王五");
  });

  it("falls back to username when first_name missing", () => {
    const event = new TelegramInputAdopter().convert(
      makeUpdate({ from: { id: 1, username: "botuser" } }),
    );
    expect(event!.content).toBe("明天那个会议室订好了吗");
    expect(event!.sender).toBe("botuser");
  });

  it("returns null for updates without text", () => {
    const event = new TelegramInputAdopter().convert(makeUpdate({ text: undefined }));
    expect(event).toBeNull();
  });
});
