import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv } from "../env.js";

/**
 * The "curiosity" email: research only, no probes.
 *
 * The probe format asserts a measured finding ("it named these three, not
 * you") and costs four web-searching calls. This one asks the client's own
 * question instead — "if a Mandarin speaking injury victim asks ChatGPT who is
 * near them, does it recommend you?" — which asserts nothing, so it can never
 * be factually wrong, yet opens the same gap because the owner cannot answer it
 * either. Two calls instead of six, and no Firecrawl credit.
 *
 * Everything specific in the email has to come from the business's own site.
 * The CSV cannot supply it: the vertical column says "Law", not "construction
 * accident and injury lawyers", and no column contains "a Mandarin speaking
 * client in Flushing" — that came from noticing an office address next to a
 * language list. So step one is a real read of the site.
 */
const MODEL = "claude-sonnet-5";
const FETCH_TOOL = "web_fetch_20260209";

let client: Anthropic | undefined;
const getClient = (): Anthropic =>
  (client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") }));

export const Research = z.object({
  credibility: z
    .array(z.string())
    .describe(
      "One or two hard, checkable facts from the SITE that show the business has earned its " +
        "position — years in business, an award with its year, a named office location, a " +
        "headline result with its figure. Facts only, never adjectives. Do NOT include the " +
        "star rating or review count: those come from the CSV and are supplied separately.",
    ),
  category: z
    .string()
    .describe(
      "What they are actually known for, in the words a client would use, specific enough to " +
        "be theirs: 'construction accident and injury lawyers in New York', not 'law'. Read " +
        "this off their results and service pages, not off a generic vertical label.",
    ),
  clientScenario: z
    .string()
    .describe(
      "One distinctive client type the business visibly spends money to win, drawn from " +
        "something concrete on the site — an office in a particular neighbourhood, an " +
        "intake language, a niche specialism. E.g. 'a Mandarin speaking injury victim in Flushing'.",
    ),
  clientQuestion: z
    .string()
    .describe(
      "The question that client would literally type into ChatGPT, in their own words, in " +
        "quotes-ready form: 'Who is a Mandarin speaking injury lawyer near me?'",
    ),
  evidence: z
    .array(z.string())
    .describe("Each fact above followed by where on the site it came from, for a human to check."),
});
export type Research = z.infer<typeof Research>;

export const CuriosityEmail = z.object({
  subject: z
    .string()
    .describe(
      "Exactly: what chatgpt and other ai says about <business name>. All lowercase, " +
        "no colon, no em dash.",
    ),
  body: z
    .string()
    .describe(
      "The full email, plain text, greeting through sign-off, in the six-step shape given. " +
        "Paragraphs are single lines with no hard wraps.",
    ),
});
export type CuriosityEmail = z.infer<typeof CuriosityEmail>;

/** Read the business's own site and pull out what the email needs. */
export async function researchSite(businessName: string, website: string): Promise<Research> {
  // Three pages, terse notes. web_fetch runs code execution under the hood, so
  // every extra page costs tool round-trips as well as content; reading the whole
  // site to write six lines of email is waste. The homepage and contact page carry
  // almost everything that matters — the offices, the languages, the positioning.
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 5_000,
    tools: [{ type: FETCH_TOOL, name: "web_fetch", max_uses: 3 } as never],
    messages: [
      {
        role: "user",
        content:
          `Research ${businessName} for a cold email. Fetch at most three pages: ${website}, ` +
          `its contact page, and one of its about or results pages if a link is obvious.\n\n` +
          `Rating and review count are already known — ignore them. Answer in under 200 words, ` +
          `as short bullets, no preamble:\n` +
          `- what they are known for, in a client's words\n` +
          `- office locations and any intake languages\n` +
          `- one distinctive client they visibly spend money to win, and why you think so\n` +
          `- years in business, awards with years, headline results with figures\n\n` +
          `Quote the site verbatim only where the exact wording matters.`,
      },
    ],
  });

  const readOut = (response.content as { type: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");

  const parsed = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 2_000,
    system:
      "Turn this research into the fields requested. Every fact must appear in the research " +
      "given — never add one that is not there, however plausible. If the research shows no " +
      "distinctive client type, say so plainly in clientScenario rather than inventing one.",
    messages: [{ role: "user", content: `BUSINESS: ${businessName}\n\nRESEARCH:\n${readOut}` }],
    output_config: { format: zodOutputFormat(Research) },
  });

  const research = parsed.parsed_output as Research | null;
  if (!research) throw new Error(`research failed: stop_reason ${parsed.stop_reason}`);
  return research;
}

export interface CuriosityInput {
  businessName: string;
  greeting: string;
  vertical: string;
  /** From the CSV, not the site — the harvested numbers are what we stand behind. */
  rating: number | null;
  reviewCount: number | null;
  research: Research;
}

/** Write the email in the six-step curiosity shape. */
export async function composeCuriosity(input: CuriosityInput): Promise<CuriosityEmail> {
  const system = [
    "You write one cold email, plain text, in exactly this six-step shape:",
    "",
    "1. `Hey {greeting},`",
    "2. One sentence granting they have earned their position, carried by the RATING and",
    "   REVIEWS if supplied plus one or two CREDIBILITY facts — e.g. `You've built a strong",
    "   position in New York injury law, 4.8 stars across 721 reviews, a Flushing office and",
    "   Mandarin intake.` Facts, never adjectives. Never 'impressive' or 'amazing'. If no",
    "   rating was supplied, carry the line on the site facts alone.",
    "3. The hinge, on its own line: `That made me curious.`",
    "4. The client's question. Name the client type, name the assistant, put their question in",
    "   quotes, and end by asking whether it recommends this business by name. This asks — it",
    "   never asserts a result, because nothing has been measured.",
    "5. Two sentences of stakes: their clients use AI to get recommendations on {category}, and",
    "   not being ranked in those searches means losing business.",
    "6. The offer: you run those searches for {vertical}, can test 10 real queries — the kind",
    "   {clientScenario} would actually type — and show which firms come up and where they rank.",
    "   Then `Free. No pitch attached.` then `Want me to run it?`",
    "",
    "Sign off with the sender name and `Armstrong - armstrongco.ai` on the next line.",
    "",
    "HARD RULES:",
    "- Never claim any search was run, or that any competitor outranks them. Nothing has been",
    "  measured. Step 4 is a question and must stay one.",
    "- Every fact must come from the research supplied. Inventing one is unrecoverable: the",
    "  owner knows their own business.",
    "- No em or en dashes anywhere, subject or body. Plain hyphens only.",
    "- Do NOT hard-wrap. Each paragraph is a single line; separate paragraphs with a blank line.",
    "- Plain words. No 'LLM', 'GEO', 'schema', 'citation-sourcing', 'optimize'.",
    "- Under 140 words. This format earns the reply by being short and specific.",
  ].join("\n");

  const user = [
    `BUSINESS: ${input.businessName}`,
    `GREETING TO USE: Hey ${input.greeting},`,
    `SENDER: Gitartha`,
    `VERTICAL (who you run these searches for): ${input.vertical}`,
    "",
    input.rating && input.reviewCount
      ? `RATING AND REVIEWS: ${input.rating} stars across ${input.reviewCount} reviews`
      : "RATING AND REVIEWS: none on file — build the line from the site facts alone",
    `CREDIBILITY FACTS: ${input.research.credibility.join(" | ")}`,
    `CATEGORY: ${input.research.category}`,
    `CLIENT SCENARIO: ${input.research.clientScenario}`,
    `CLIENT QUESTION: ${input.research.clientQuestion}`,
  ].join("\n");

  // 4k, not 2k: the email is short but it ships inside a structured-output
  // wrapper, and at 2k three rows in the first batch died on stop_reason
  // max_tokens after the research had already been paid for.
  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 4_000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(CuriosityEmail) },
  });

  const email = response.parsed_output as CuriosityEmail | null;
  if (!email) throw new Error(`compose failed: stop_reason ${response.stop_reason}`);
  return email;
}
