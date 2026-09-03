/**
 * Public SuperGrok tool: text-only accept-and-ack to Joe.
 * Optional inbox webhook (Worker secrets). Never invent a URL or key.
 */

import type { GatewayEnv } from "./cors";

export const MESSAGE_JOE_TOOL_NAME = "message_joe";
export const MESSAGE_JOE_MAX_CHARS = 4000;
const INBOX_TIMEOUT_MS = 4_000;

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[::1\]|::1)/i;

export interface MessageJoeAck {
  tool: typeof MESSAGE_JOE_TOOL_NAME;
  accepted: true;
  textOnly: true;
  woken: boolean;
  delivered: boolean;
  note: string;
  chars: number;
}

export interface InboxWebhook {
  url: string;
  key: string;
}

/**
 * Resolve inbox webhook from Worker secrets.
 * Prefer HEDGEHOG_INBOX_URL + HEDGEHOG_INBOX_KEY; JOE_INBOX_* are aliases.
 * Both URL and key must be set. HTTPS only. No private/mesh hosts.
 */
export function inboxWebhookFromEnv(env: GatewayEnv): InboxWebhook | null {
  const url = (env.HEDGEHOG_INBOX_URL ?? env.JOE_INBOX_URL)?.trim() ?? "";
  const key = (env.HEDGEHOG_INBOX_KEY ?? env.JOE_INBOX_KEY)?.trim() ?? "";
  if (!url || !key) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (PRIVATE_HOST.test(parsed.hostname)) return null;
  return { url, key };
}

function textOnlyMessage(args: Record<string, unknown>): string {
  const raw = args.message;
  if (typeof raw !== "string") return "";
  return raw.replace(/\r\n/g, "\n").trim().slice(0, MESSAGE_JOE_MAX_CHARS);
}

function ack(partial: Omit<MessageJoeAck, "tool" | "accepted" | "textOnly">): MessageJoeAck {
  return {
    tool: MESSAGE_JOE_TOOL_NAME,
    accepted: true,
    textOnly: true,
    ...partial,
  };
}

/**
 * Accept a text message and ack. Never requires mesh keys.
 * If the inbox webhook is unset or the POST fails, still succeed —
 * Joe was not woken. Do not fail the tool.
 */
export async function executeMessageJoe(
  args: Record<string, unknown>,
  env: GatewayEnv,
): Promise<MessageJoeAck> {
  const message = textOnlyMessage(args);
  const webhook = inboxWebhookFromEnv(env);

  if (!message) {
    return ack({
      woken: false,
      delivered: false,
      chars: 0,
      note: "Message accepted (empty). Joe was not woken.",
    });
  }

  if (!webhook) {
    return ack({
      woken: false,
      delivered: false,
      chars: message.length,
      note: "Message accepted. Inbox webhook is unset — Joe was not woken.",
    });
  }

  const delivered = await postInboxText(webhook, message);
  if (!delivered) {
    return ack({
      woken: false,
      delivered: false,
      chars: message.length,
      note: "Message accepted. Inbox webhook did not wake Joe.",
    });
  }

  return ack({
    woken: true,
    delivered: true,
    chars: message.length,
    note: "Message accepted and posted to the inbox webhook.",
  });
}

async function postInboxText(webhook: InboxWebhook, message: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INBOX_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(webhook.url, {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${webhook.key}`,
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: message,
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
