import { MessageEvent } from "@/domain/event/model";
import { nanoid } from "nanoid";

// Minimal Telegram Bot API types — only fields we use.
// Full spec: https://core.telegram.org/bots/api#update
interface TelegramChat {
  id: number | string;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_bot?: boolean;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: { id: number; is_bot?: boolean; first_name?: string; username?: string };
  text?: string;
  // Other fields omitted — we only need chat.id and text.
}

interface BaseUpdate {
  update_id: number;
}

interface WithMessage extends BaseUpdate {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

type Update = BaseUpdate & WithMessage;

/**
 * Convert a Telegram Bot API Update to a MessageEvent.
 *
 * Handles: message, edited_message, channel_post, edited_channel_post.
 * Returns null for unsupported update types (reactions, polls, etc.).
 */
export function convertTelegramUpdateToMessageEvent(update: Update): MessageEvent | null {
  // Extract the message-like object from whichever payload is present
  const msg = update.message
    ?? update.edited_message
    ?? update.channel_post
    ?? update.edited_channel_post;

  if (!msg || !msg.chat?.id || !msg.text) {
    return null;
  }

  return {
    id: nanoid(10),
    chat_id: String(msg.chat.id),
    adapter: "telegram",
    event_type: "message",
    payload: { content: msg.text },
  };
}
