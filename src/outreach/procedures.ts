import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv } from "../env.js";
import { loadPages, stripLoneSurrogates } from "./store.js";

const MODEL = "claude-sonnet-5";

/**
 * Read a slice of EVERY page rather than all of the biggest ones.
 *
 * Filling a flat budget richest-first meant Born Again Doctor's menu was read
 * off five long pages while `18-erectile-dysfunction.md` and the hair
 * restoration pages were never seen — so the email probed thread lifts and
 * dermal fillers while the practice's two highest-ticket services went
 * unmentioned. A service menu is spread across many short pages by nature; it
 * needs breadth, not depth.
 */
const PER_PAGE_CHARS = 2_500;
const MAX_PAGES = 40;

let client: Anthropic | undefined;
const getClient = (): Anthropic =>
  (client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") }));

export const ServiceMenu = z.object({
  category: z
    .string()
    .describe(
      'What a patient would call this place when searching: "med spa", "dermatology clinic", ' +
        '"plastic surgery practice". Used for the broad "best <category> in <city>" probe.',
    ),
  procedures: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            'The procedure as a patient would search it, in two or three plain words: ' +
              '"hair restoration", "CoolSculpting", "ED shockwave therapy". No parentheses ' +
              'and no brand qualifiers — "dermal fillers", never "dermal fillers (Juvederm)". ' +
              "This string is printed in the email's left column and long ones break it.",
          ),
        evidence: z.string().describe("The page URL where this business offers it."),
        ticket: z
          .enum(["high", "medium", "low"])
          .describe(
            "high = a several-thousand-dollar course of treatment someone researches for " +
              "weeks and travels for: hair restoration, ED treatment, body contouring, " +
              "surgery, hormone or weight-loss programmes. medium = a few hundred dollars, " +
              "repeated: fillers, thread lifts, laser. low = one cheap visit: facial, wax, " +
              "brow tint. Judge by what a patient pays over a course of treatment, not by " +
              "how prominently the website features it.",
          ),
      }),
    )
    .describe(
      "Every distinct procedure the PAGES show this business performing, richest first. " +
        "Only what the pages actually support.",
    ),
});
export type ServiceMenu = z.infer<typeof ServiceMenu>;

const SYSTEM = [
  "You read a business's own website and list what it actually does.",
  "",
  "HARD RULES:",
  "- Only procedures the pages show THIS business performing. If the page is a blog post",
  "  about a treatment they do not offer, it does not count.",
  "- Name procedures the way a patient searches, not the way a marketing page titles them.",
  '  "Renew & Restore Package" is not a procedure; the hair restoration inside it is.',
  "- Do not pad the list. Five real procedures beat twelve vague ones.",
  "- Every entry needs the page URL it came from.",
].join("\n");

/**
 * What this business sells, read off its own site.
 *
 * The email names three procedures and asks an AI where to go for each, so this
 * list decides what gets probed. Getting it wrong is expensive in both
 * directions: a procedure they don't offer makes the email obviously wrong to
 * the one person who would know, and a cheap procedure wastes the slot — nobody
 * changes vendors over a $90 facial, so `ticket` exists to sort for the
 * treatments worth an owner's attention.
 */
export async function readServiceMenu(domain: string): Promise<ServiceMenu> {
  const pages = await loadPages(domain);
  if (!pages.length) throw new Error(`No stored pages for ${domain}. Run crawl-batch first.`);

  // Slicing at a fixed character count can cut an emoji's surrogate pair in
  // half, and a lone surrogate makes the JSON request body invalid — the API
  // rejects it with `no low surrogate in string`. Sanitise after the cut.
  const corpus = pages
    .slice(0, MAX_PAGES)
    .map((page) => `--- ${page.url}\n${stripLoneSurrogates(page.text.slice(0, PER_PAGE_CHARS))}`);

  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 8_000,
    system: SYSTEM,
    messages: [
      { role: "user", content: `DOMAIN: ${domain}\n\nPAGES:\n${corpus.join("\n\n")}` },
    ],
    output_config: { format: zodOutputFormat(ServiceMenu) },
  });

  const parsed = response.parsed_output as ServiceMenu | null;
  if (!parsed) throw new Error(`service menu failed: stop_reason ${response.stop_reason}`);
  return parsed;
}

/** Words that carry no distinguishing meaning between procedures. */
const FILLER = new Set([
  "for", "and", "the", "with", "of", "therapy", "treatment", "treatments",
  "procedure", "non", "surgical", "surgery", "care", "medical",
]);

const contentWords = (name: string): Set<string> =>
  new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !FILLER.has(w)),
  );

/**
 * The procedures worth probing: highest ticket first, and each about something
 * genuinely different.
 *
 * Exact-name dedupe is not enough. Born Again Doctor's menu ranked "hair
 * restoration", "PRP for hair restoration" and "stem cell therapy for hair
 * loss" as three distinct high-ticket entries, which would have produced three
 * result lines all saying the same thing about hair — and an email that reads
 * like one finding padded out to fill the block. Overlapping on any content
 * word is close enough to being the same procedure.
 */
export function pickProcedures(menu: ServiceMenu, count = 3): string[] {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const picked: { name: string; words: Set<string> }[] = [];

  for (const procedure of [...menu.procedures].sort((a, b) => rank[a.ticket] - rank[b.ticket])) {
    if (picked.length >= count) break;
    const words = contentWords(procedure.name);
    if (!words.size) continue;
    const overlaps = picked.some((p) => [...words].some((w) => p.words.has(w)));
    if (overlaps) continue;
    picked.push({ name: procedure.name, words });
  }
  return picked.map((p) => p.name);
}
