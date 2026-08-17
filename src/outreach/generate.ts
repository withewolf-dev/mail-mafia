import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv } from "../env.js";
import { loadPages } from "./store.js";

const MODEL = "claude-sonnet-5";

/** Enough for the model to find something specific; past this it pads. */
const MAX_EVIDENCE_CHARS = 45_000;

let client: Anthropic | undefined;
const getClient = (): Anthropic =>
  (client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") }));

export const GeneratedEmail = z.object({
  subjects: z
    .array(z.string())
    .describe("Three to five short subject lines, pulled from the email's own strongest line."),
  body: z
    .string()
    .describe("The full email body including greeting and sign-off. Plain text, no markdown."),
  evidenceUsed: z
    .array(z.string())
    .describe(
      "Every factual claim the email makes about this business, each followed by the page it " +
        "came from. One line each. This is what a human checks the email against.",
    ),
  notSaid: z
    .array(z.string())
    .describe("Anything you wanted to claim but dropped because the pages did not support it."),
});
export type GeneratedEmail = z.infer<typeof GeneratedEmail>;

export interface ProspectFacts {
  name: string;
  city: string;
  region: string;
  category: string | null;
  rating?: number;
  reviewCount?: number;
}

/** Probe results, when a visibility check has been run. Optional by design. */
export interface ProbeFacts {
  label: string;
  namedIn: number;
  runs: number;
  competitors: string[];
  pagesRead: number;
  ownSiteRead: boolean;
}

const docPath = (name: string): string => resolve(import.meta.dirname, name);

/**
 * Write the email from stored pages, constrained by offer.md and skeleton.md.
 *
 * The two docs do different jobs: skeleton.md fixes the shape, offer.md fixes
 * what may be said and — more importantly — what may not. Evidence comes only
 * from the crawled pages and the Maps row, so anything the model wants to add
 * has to survive `evidenceUsed`, where a human can see the claim next to its
 * source.
 */
export async function generateEmail(
  domain: string,
  prospect: ProspectFacts,
  probes: ProbeFacts[] = [],
): Promise<{ email: GeneratedEmail; pagesUsed: string[] }> {
  const [offer, skeleton, pages] = await Promise.all([
    readFile(docPath("offer.md"), "utf8"),
    readFile(docPath("skeleton.md"), "utf8"),
    loadPages(domain),
  ]);

  if (pages.length === 0) {
    throw new Error(`No stored pages for ${domain}. Run crawl-one first.`);
  }

  // Richest pages first, to a budget — the thin ones are nav shells.
  const used: string[] = [];
  let budget = MAX_EVIDENCE_CHARS;
  const corpus: string[] = [];
  for (const page of pages) {
    if (budget <= 0) break;
    const slice = page.text.slice(0, Math.min(budget, 12_000));
    corpus.push(`--- ${page.url}\n${slice}`);
    used.push(page.url);
    budget -= slice.length;
  }

  const system = [
    "You write one cold email. Follow both documents below exactly.",
    "",
    "=== OFFER (what Armstrong is, and what you may never claim) ===",
    offer,
    "",
    "=== SKELETON (the shape of the email) ===",
    skeleton,
    "",
    "HARD RULES:",
    "- Every factual statement about this business must come from the PAGES below.",
    "  If you cannot point at the page, do not write the sentence.",
    probes.length
      ? "- Probe results are supplied. You may state what they show, and name only those competitors."
      : "- NO probe was run. You may NOT claim they are absent from AI answers, not recommended, " +
        "invisible, or that competitors are named instead. Build the email on what the pages show " +
        "and on what customers would ask, framed as an opportunity rather than a finding.",
    "- evidenceUsed must list every claim with the page it came from, so a human can check it.",
  ].join("\n");

  const user = [
    `BUSINESS: ${prospect.name}`,
    `CITY: ${prospect.city}, ${prospect.region}`,
    `CATEGORY: ${prospect.category ?? "(unknown — infer from the pages)"}`,
    prospect.rating
      ? `GOOGLE: ${prospect.rating} stars, ${prospect.reviewCount ?? "?"} reviews`
      : "GOOGLE: no rating on file — skip the social proof slot",
    "",
    probes.length
      ? [
          "PROBE RESULTS:",
          ...probes.map(
            (p) =>
              `- "${p.label}": named in ${p.namedIn}/${p.runs} runs; ` +
              `recommended instead: ${p.competitors.join(", ") || "none"}; ` +
              `${p.pagesRead} pages read; their own site read: ${p.ownSiteRead ? "yes" : "no"}`,
          ),
        ].join("\n")
      : "PROBE RESULTS: none run.",
    "",
    `PAGES (${used.length} of ${pages.length}, richest first):`,
    corpus.join("\n\n"),
  ].join("\n");

  // max_tokens covers thinking AND the answer. At 3000 the model spent the
  // whole budget reasoning and emitted nothing at all — stop_reason max_tokens,
  // a single `thinking` block, parsed_output null. Budget for both.
  for (const maxTokens of [16_000, 32_000]) {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(GeneratedEmail) },
    });

    const parsed = response.parsed_output as GeneratedEmail | null;
    if (parsed) return { email: parsed, pagesUsed: used };
    if (response.stop_reason !== "max_tokens") {
      throw new Error(`generation failed: stop_reason ${response.stop_reason}`);
    }
  }
  throw new Error("generation failed: ran out of output budget twice");
}
