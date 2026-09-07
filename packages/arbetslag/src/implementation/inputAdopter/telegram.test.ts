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
  it("formats content like the system prompt example: [HH:MM] 发送者: 内容", () => {
    const event = new TelegramInputAdopter().convert(makeUpdate());
    expect(event).not.toBeNull();
    expect(event!.content).toMatch(
      /^【最近聊天记录】\n\[\d{2}:\d{2}\] 王五: 明天那个会议室订好了吗$/,
    );
  });

  it("falls back to username when first_name missing", () => {
    const event = new TelegramInputAdopter().convert(
      makeUpdate({ from: { id: 1, username: "botuser" } }),
    );
    expect(event!.content).toContain("botuser: 明天那个会议室订好了吗");
  });

  it("returns null for updates without text", () => {
    const event = new TelegramInputAdopter().convert(makeUpdate({ text: undefined }));
    expect(event).toBeNull();
  });
});
