import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv } from "../env.js";

/**
 * Ask an AI assistant where to go, and record what it actually answers.
 *
 * This is the evidence the whole email rests on. The pitch is "you are absent
 * from AI answers and these competitors are named instead" — a claim about a
 * specific business, made to its owner, who can check it in thirty seconds. So
 * it is measured, never assumed: `offer.md` and the project rules both forbid
 * asserting invisibility without a probe behind it.
 *
 * The model runs with web search on, exactly as a patient's ChatGPT would.
 */
const MODEL = "claude-sonnet-5";
const SEARCH_TOOL = "web_search_20260209";

let client: Anthropic | undefined;
const getClient = (): Anthropic =>
  (client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") }));

export interface ProbeResult {
  /** Short label for the email's left column: "hair restoration". */
  label: string;
  /** The question actually asked. */
  query: string;
  /** Did the answer name this business? */
  namedUs: boolean;
  /** Businesses the answer recommended instead, in the order given. */
  competitors: string[];
  /** Whether the model read the prospect's own site while answering. */
  ownSiteRead: boolean;
  /** How many sources the model consulted. */
  sourceCount: number;
  /** The answer itself, kept so a human can check the reading. */
  answer: string;
}

const Reading = z.object({
  namedUs: z
    .boolean()
    .describe(
      "True only if the answer recommends THIS business by name. A passing mention in a " +
        "list of unrelated links does not count, and a different business with a similar " +
        "name definitely does not.",
    ),
  competitors: z
    .array(z.string())
    .describe(
      "Other businesses the answer recommends, in the order given, as written. Real named " +
        "businesses only — not categories, not 'consult your doctor', not directory sites " +
        "like Yelp or Healthgrades.",
    ),
  note: z.string().describe("One line on how you read it, for a human checking the call."),
});

/** Ask the question with web search on, and keep what came back. */
async function ask(query: string): Promise<{ answer: string; sources: string[] }> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2_000,
    tools: [{ type: SEARCH_TOOL, name: "web_search", max_uses: 5 } as never],
    messages: [{ role: "user", content: query }],
  });

  let answer = "";
  const sources = new Set<string>();
  for (const block of response.content as { type: string; text?: string; content?: { url?: string }[] }[]) {
    if (block.type === "text" && block.text) answer += block.text;
    if (block.type === "web_search_tool_result") {
      for (const item of block.content ?? []) if (item?.url) sources.add(item.url);
    }
  }
  return { answer, sources: [...sources] };
}

/**
 * Read the answer with a second call rather than a regex.
 *
 * `_probe3.ts` decided "named" with `/aqua\s*med\s*spa/i` over the raw text,
 * which cannot tell a recommendation from "not to be confused with", and
 * scraped competitors out of markdown bold — so a bolded heading counted as a
 * business. Both mistakes point the same way: they invent absence or presence
 * that isn't there, and that lands in a stranger's inbox as a factual claim.
 */
async function readAnswer(
  businessName: string,
  domain: string,
  answer: string,
): Promise<z.infer<typeof Reading>> {
  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 4_000,
    system: [
      "You read an AI assistant's answer to a 'where should I go for X' question and record",
      "who it recommended. You are scoring an answer, not judging the businesses.",
      "",
      "- namedUs is about recommendation, not mention. If the business appears only as a",
      "  citation URL or an aside, that is false.",
      "- competitors are businesses a patient could actually book with. Drop directories",
      "  (Yelp, Healthgrades, RealSelf), hospitals mentioned in passing, and generic advice.",
      "- Copy business names as the answer wrote them.",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          `BUSINESS: ${businessName}`,
          `DOMAIN: ${domain}`,
          "",
          "ANSWER TO SCORE:",
          answer,
        ].join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(Reading) },
  });
  const parsed = response.parsed_output as z.infer<typeof Reading> | null;
  if (!parsed) throw new Error(`probe reading failed: stop_reason ${response.stop_reason}`);
  return parsed;
}

export interface ProbeTarget {
  businessName: string;
  domain: string;
  city: string;
  region: string;
}

/** One procedure-level probe: "where do I go in <city> for <procedure>". */
export async function probeProcedure(
  target: ProbeTarget,
  procedure: string,
): Promise<ProbeResult> {
  const query =
    `Where should I go in ${target.city}, ${target.region} for ${procedure}? ` +
    `Name specific businesses you would recommend.`;
  const { answer, sources } = await ask(query);
  const reading = await readAnswer(target.businessName, target.domain, answer);

  const root = target.domain.replace(/^www\./, "").split(".")[0]!;
  return {
    label: procedure,
    query,
    namedUs: reading.namedUs,
    competitors: reading.competitors,
    ownSiteRead: sources.some((u) => u.toLowerCase().includes(root.toLowerCase())),
    sourceCount: sources.length,
    answer,
  };
}

/**
 * The broad-category probe.
 *
 * Its job in the email is the contrast: showing up for "best med spa in Ocala"
 * while vanishing on the procedures people actually book is a sharper, more
 * credible finding than blanket invisibility — and it is falsifiable, so it
 * has to be measured rather than assumed either way.
 */
export async function probeCategory(
  target: ProbeTarget,
  category: string,
): Promise<ProbeResult> {
  const query =
    `What is the best ${category} in ${target.city}, ${target.region}? Name specific businesses.`;
  const { answer, sources } = await ask(query);
  const reading = await readAnswer(target.businessName, target.domain, answer);

  const root = target.domain.replace(/^www\./, "").split(".")[0]!;
  return {
    label: category,
    query,
    namedUs: reading.namedUs,
    competitors: reading.competitors,
    ownSiteRead: sources.some((u) => u.toLowerCase().includes(root.toLowerCase())),
    sourceCount: sources.length,
    answer,
  };
}
