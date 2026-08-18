import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv } from "../env.js";
import type { MarketFacts } from "./market.js";
import type { ProbeResult } from "./probe.js";

const MODEL = "claude-sonnet-5";

let client: Anthropic | undefined;
const getClient = (): Anthropic =>
  (client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") }));

export const ComposedEmail = z.object({
  subject: z
    .string()
    .describe(
      "One subject line, lowercase, no colon, pulled from the email's own strongest line. " +
        "Never invents an idea the body does not contain.",
    ),
  body: z
    .string()
    .describe(
      "The full email, plain text, greeting through sign-off, in the skeleton's exact shape. " +
        "Paragraphs are single lines with no hard wraps; the result block is 'Service: rivals. Not you.' entries, one per line, blank line between, no arrows.",
    ),
  evidenceUsed: z
    .array(z.string())
    .describe(
      "Every factual claim the email makes, each followed by where it came from. This is what " +
        "a human checks the email against before it sends.",
    ),
  notSaid: z
    .array(z.string())
    .describe("Anything dropped because the evidence did not support it."),
});
export type ComposedEmail = z.infer<typeof ComposedEmail>;

export interface ComposeInput {
  businessName: string;
  city: string;
  region: string;
  /** How to greet them: "Sualeh" or "Dr. Hassanein". Decided by the caller. */
  greeting: string;
  rating: number | null;
  reviewCount: number | null;
  /** Procedure probes where the answer did NOT name them. */
  misses: ProbeResult[];
  /** The broad "best <category> in <city>" probe, if it ran. */
  category: ProbeResult | null;
  market: MarketFacts;
  /** Total probes run, for the CTA's number. */
  probeCount: number;
}

const docPath = (name: string): string => resolve(import.meta.dirname, name);

/**
 * Write the email from probe evidence, in the skeleton's fixed shape.
 *
 * Everything factual here was measured before this function ran: the misses are
 * real answers to real questions, the competitor names are the ones those
 * answers gave, the market figures came from published sources. The model's job
 * is arrangement and voice, not research — which is why `evidenceUsed` exists,
 * and why the prompt below repeats that inventing a competitor is the one
 * unrecoverable mistake. An owner who spots a made-up rival stops reading, and
 * the true part of the email dies with the false part.
 */
export async function composeEmail(input: ComposeInput): Promise<ComposedEmail> {
  const [offer, skeleton] = await Promise.all([
    readFile(docPath("offer.md"), "utf8"),
    readFile(docPath("skeleton.md"), "utf8"),
  ]);

  const system = [
    "You write one cold email. Follow both documents below exactly.",
    "",
    "=== OFFER (what Armstrong is, and what you may never claim) ===",
    offer,
    "",
    "=== SKELETON (the shape, slot by slot — follow it literally) ===",
    skeleton,
    "",
    "HARD RULES:",
    "- The probe results below are the ONLY source of competitor names. Never add a business",
    "  that is not in them, however plausible it sounds locally. This is the one mistake the",
    "  email cannot survive: the owner knows their own market.",
    "- Use the greeting given. Do not re-derive it, do not add a title that was not supplied.",
    "- The result block: one entry per service, written 'Service: rivals. Not you.' — the",
    "  service name capitalized, then a colon, then the rivals, then 'Not you.' verbatim.",
    "  NO arrows, NO space padding, NO columns: this is plain-text email read in a proportional",
    "  font (Gmail etc.) where alignment shatters. Put a BLANK LINE between entries so that when",
    "  a line wraps on a phone the entries stay visually separate.",
    "- Do NOT hard-wrap the prose. Write each paragraph as a single line with no newlines inside",
    "  it; separate paragraphs with one blank line. The reader's client wraps to their screen —",
    "  baked-in line breaks become ragged mid-sentence wraps on a phone.",
    "- Shorten rival names to how a local would say them out loud. 'Marion Dermatology',",
    "  not 'Marion Dermatology (Bryan C. Hicks, MD)'. Drop the city suffix, the practitioner",
    "  parenthetical and the legal form (LLC, PA). Two or three rivals per line, never more.",
    "- Market figures may be used only as supplied, but say them the way a person would:",
    "  'Hair transplant is an $11B global market growing 22% a year.' Never write CAGR,",
    "  'valued at', or 'projected to reach' — that is analyst copy, not a sentence someone",
    "  reads in an inbox. One short line each, two lines maximum.",
    "- If the category probe did not name them, do NOT write the 'you do come up' contrast.",
    "  Use the depth line from slot 7's fallback instead.",
    "- evidenceUsed lists every claim with its source.",
  ].join("\n");

  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const lines = input.misses.map(
    (m) => `${cap(m.label)}: ${m.competitors.slice(0, 3).join(", ")}. Not you.`,
  );

  const user = [
    `BUSINESS: ${input.businessName}`,
    `CITY: ${input.city}, ${input.region}`,
    `GREETING TO USE: Hey ${input.greeting},`,
    input.rating
      ? `GOOGLE: ${input.rating} stars, ${input.reviewCount ?? "?"} reviews`
      : "GOOGLE: no usable rating — skip the social proof slot and open on the behaviour shift",
    "",
    `PROBES RUN: ${input.probeCount}`,
    "",
    "PROCEDURE PROBES THAT DID NOT NAME THEM (use these, in this order):",
    ...input.misses.map(
      (m) =>
        `- "${m.label}" — asked: ${m.query}\n` +
        `  named instead: ${m.competitors.join(", ") || "(none named)"}\n` +
        `  sources read: ${m.sourceCount}; own site read: ${m.ownSiteRead ? "yes" : "no"}`,
    ),
    "",
    "SUGGESTED RESULT BLOCK (one entry per service, blank line between, no arrows):",
    lines.join("\n\n"),
    "",
    input.category
      ? `CATEGORY PROBE: "${input.category.label}" — named them: ${input.category.namedUs ? "YES" : "NO"}` +
        `; named instead: ${input.category.competitors.join(", ") || "(none)"}`
      : "CATEGORY PROBE: not run.",
    "",
    input.market.stats.length
      ? [
          "MARKET FIGURES (use verbatim, at most two):",
          ...input.market.stats.map((s) => `- ${s.claim}  [${s.source}]`),
        ].join("\n")
      : "MARKET FIGURES: none found — omit that slot.",
  ].join("\n");

  for (const maxTokens of [16_000, 32_000]) {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(ComposedEmail) },
    });
    const parsed = response.parsed_output as ComposedEmail | null;
    if (parsed) return parsed;
    if (response.stop_reason !== "max_tokens") {
      throw new Error(`compose failed: stop_reason ${response.stop_reason}`);
    }
  }
  throw new Error("compose failed: ran out of output budget twice");
}

/**
 * How to address them.
 *
 * A physician expects the title and its absence reads as junk mail; an
 * esthetician given "Dr." reads as a mail merge that guessed. The licence
 * profession is the reliable signal — it is what the state recorded, not what a
 * marketing page called them.
 */
export function greetingFor(
  firstName: string,
  lastName: string,
  ownerNotes: string | null,
): string {
  const doctor = /Medical Doctor|Osteopathic|\bDO\b|physician|surgeon|dermatolog/i.test(
    ownerNotes ?? "",
  );
  return doctor ? `Dr. ${lastName}` : firstName;
}
