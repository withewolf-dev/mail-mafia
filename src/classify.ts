import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { requireEnv } from "./env.js";
import { Classification, type ParsedReply, type ProspectContext } from "./types.js";

/**
 * Matches the model the n8n workflow ran. Classification is the cheapest call
 * in the system but the most expensive to get wrong — worth A/B-ing against
 * claude-sonnet-5 on real replies before this handles volume.
 */
const MODEL = "claude-haiku-4-5";

/**
 * Below this, the intent is forced to UNCLEAR and a human looks at it.
 * The prompt says so and the code enforces it — see `classifyReply`.
 */
export const CONFIDENCE_FLOOR = 0.8;

const SYSTEM = `You classify replies to B2B cold outreach for Armstrong, an AI-search visibility service.

intent must be exactly one of:
INTERESTED - wants a call, a demo, or says yes
SEND_REPORT - wants the free visibility report but not a call yet
OBJECTION - engaged but pushing back (price, timing, already have an agency, trust)
REFERRAL - forwarding to someone else or naming another contact
OOO - auto-reply, out of office, on leave
NOT_INTERESTED - clear no, unsubscribe, stop emailing
UNCLEAR - anything else

HARD RULE: if confidence < ${CONFIDENCE_FLOOR}, intent MUST be UNCLEAR.

confidence is your calibrated probability that the intent is correct. A reply that
carries two intents at once ("too expensive, but check back in March") is not a
confident single label - score it accordingly.

objection_type: only when intent is OBJECTION, else null.
suggested_reply: max 60 words, plain, no exclamation marks, no emoji. Sign off as Danish.`;

/**
 * Built on first use, not at import time — so importing this module for
 * `applyConfidenceFloor` (as the tests do) never needs an API key.
 */
let client: Anthropic | undefined;
function getClient(): Anthropic {
  return (client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") }));
}

/**
 * Classify one reply into a state transition.
 *
 * The confidence floor is enforced here, after the model returns — the prompt
 * asks for it, but a prompt is guidance and code is a guarantee. The failure
 * mode is silent: a misread "already have an agency, but call me in March"
 * filed as NOT_INTERESTED kills the best lead in the batch and nobody sees it.
 */
export async function classifyReply(
  reply: ParsedReply,
  prospect: ProspectContext = {},
): Promise<Classification> {
  const user = [
    `PROSPECT: ${prospect.name ?? "unknown"} (${prospect.category ?? "?"}, ${prospect.city ?? "?"})`,
    `WE SENT: ${prospect.subject ?? "(unknown subject)"}`,
    "",
    "THEIR REPLY:",
    reply.replyText,
  ].join("\n");

  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(Classification) },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    // Schema-constrained output failed (refusal, or max_tokens mid-object).
    // Fail closed: a human reads it rather than the system guessing.
    return {
      intent: "UNCLEAR",
      objection_type: null,
      confidence: 0,
      suggested_reply: "",
    };
  }

  return applyConfidenceFloor(parsed);
}

/** Exported so the floor itself is testable without an API call. */
export function applyConfidenceFloor(c: Classification): Classification {
  return c.confidence < CONFIDENCE_FLOOR ? { ...c, intent: "UNCLEAR" } : c;
}
