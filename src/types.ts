import { z } from "zod";

/**
 * The seven states a reply can put a prospect in. Every one of these is a
 * transition in the state machine — if a reply doesn't move the prospect, it
 * isn't an intent, it's noise.
 */
export const Intent = z.enum([
  "INTERESTED", // wants a call, a demo, or says yes
  "SEND_REPORT", // wants the free visibility report but not a call yet
  "OBJECTION", // engaged but pushing back (price, timing, agency, trust)
  "REFERRAL", // forwarding to someone else or naming another contact
  "OOO", // auto-reply, out of office, on leave
  "NOT_INTERESTED", // clear no, unsubscribe, stop emailing
  "UNCLEAR", // anything else — and anything below the confidence floor
]);
export type Intent = z.infer<typeof Intent>;

export const Classification = z.object({
  intent: Intent,
  objection_type: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  suggested_reply: z.string(),
});
export type Classification = z.infer<typeof Classification>;

/** A reply reduced to just the prospect's own words, plus who sent it. */
export interface ParsedReply {
  messageId: string;
  threadId: string;
  email: string;
  domain: string;
  from: string;
  subject: string;
  replyText: string;
}

/** What we knew about the prospect before they replied. */
export interface ProspectContext {
  placeId?: string;
  name?: string;
  category?: string;
  city?: string;
  /** Subject line of the outbound email they're replying to. */
  subject?: string;
}
