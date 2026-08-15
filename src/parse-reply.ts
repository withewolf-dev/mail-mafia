import type { ParsedReply } from "./types.js";

/** Shape of the bits of a Gmail message we actually read. */
export interface RawMessage {
  id: string;
  threadId: string;
  snippet?: string;
  text?: string;
  html?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/**
 * Everything from here down is our own outbound copy quoted back at us.
 * Leaving it in reliably over-scores intent, because our email is full of
 * enthusiastic buying language and the classifier reads it as theirs.
 */
const QUOTED_THREAD_RE =
  /\n>|^On .*wrote:|-----Original Message-----|________________________________/m;

const MAX_REPLY_CHARS = 2000;

export function parseReply(message: RawMessage): ParsedReply {
  const headers = new Map<string, string>();
  for (const h of message.payload?.headers ?? []) {
    headers.set(h.name.toLowerCase(), h.value);
  }

  const from = headers.get("from") ?? "";
  const email = from.match(EMAIL_RE)?.[0].toLowerCase() ?? "";
  const domain = email.split("@")[1] ?? "";

  let body = message.text ?? message.snippet ?? "";
  if (!body && message.html) body = message.html.replace(/<[^>]+>/g, " ");

  const replyText = body
    .split(QUOTED_THREAD_RE)[0]!
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_REPLY_CHARS);

  return {
    messageId: message.id,
    threadId: message.threadId,
    email,
    domain,
    from,
    subject: headers.get("subject") ?? "",
    replyText,
  };
}
