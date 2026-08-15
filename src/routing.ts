import type { Classification, Intent } from "./types.js";

/**
 * What the system is allowed to do on its own, per intent.
 *
 * Only INTERESTED and SEND_REPORT auto-reply. Everything else routes to a
 * human via Slack, or exits the sequence. Widening this list is the single
 * fastest way to burn a domain and a lead at the same time.
 */
export type Action =
  | { kind: "auto_reply"; template: "booking_link" | "confirm_report" }
  | { kind: "notify_human"; reason: string }
  | { kind: "suppress_domain" }
  | { kind: "requeue_silently" };

export function routeIntent(c: Classification): Action {
  const intent: Intent = c.intent;
  switch (intent) {
    case "INTERESTED":
      return { kind: "auto_reply", template: "booking_link" };
    case "SEND_REPORT":
      return { kind: "auto_reply", template: "confirm_report" };
    case "OBJECTION":
      return { kind: "notify_human", reason: c.objection_type ?? "objection" };
    case "REFERRAL":
      return { kind: "notify_human", reason: "referral — new contact named" };
    case "NOT_INTERESTED":
      return { kind: "suppress_domain" };
    case "OOO":
      return { kind: "requeue_silently" };
    case "UNCLEAR":
      return { kind: "notify_human", reason: "below confidence floor" };
  }
}
