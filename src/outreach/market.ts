import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv } from "../env.js";

const MODEL = "claude-sonnet-5";
const SEARCH_TOOL = "web_search_20260209";

let client: Anthropic | undefined;
const getClient = (): Anthropic =>
  (client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") }));

export const MarketFacts = z.object({
  stats: z
    .array(
      z.object({
        procedure: z.string().describe("Which procedure this figure is about."),
        claim: z
          .string()
          .describe(
            'One line, as it would appear in the email: "Hair transplant is an $11B global ' +
              'market growing 22% a year."',
          ),
        source: z.string().describe("The firm or publication the figure comes from, and the year."),
        url: z.string().describe("Where it can be checked."),
      }),
    )
    .describe(
      "One figure per procedure, only where a real published figure was found. Skip a " +
        "procedure entirely rather than estimate one.",
    ),
});
export type MarketFacts = z.infer<typeof MarketFacts>;

const SYSTEM = [
  "You find published market-size figures for cosmetic and medical procedures.",
  "",
  "HARD RULES:",
  "- Only figures that appear in a real published source you actually found. Never estimate,",
  "  never interpolate, never round a number you did not see.",
  "- Give the source and a URL for each. A figure that cannot be checked is not usable.",
  "- If a procedure has no credible published figure, omit it. An email with two solid",
  "  numbers beats one with three where the third is invented.",
  "- Prefer global or US market size with a growth rate, recent years only.",
].join("\n");

/**
 * Market-size lines for the procedures the prospect is missing from.
 *
 * These go in front of a doctor who may well know their own market, so a made-up
 * figure does more damage than none — it discredits the probe findings, which are
 * the part that is actually true and actually theirs. Hence real search, real
 * sources, and an explicit instruction to return fewer stats rather than invent
 * one.
 *
 * The result is cached by the caller: the market for hair restoration does not
 * differ between two prospects in the same county.
 */
export async function findMarketStats(procedures: string[]): Promise<MarketFacts> {
  if (!procedures.length) return { stats: [] };

  const research = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4_000,
    tools: [{ type: SEARCH_TOOL, name: "web_search", max_uses: 6 } as never],
    messages: [
      {
        role: "user",
        content:
          `Find published market size and growth figures for these procedures: ` +
          `${procedures.join(", ")}. Give the figure, the source, the year, and the URL.`,
      },
    ],
  });

  let findings = "";
  for (const block of research.content as { type: string; text?: string }[]) {
    if (block.type === "text" && block.text) findings += block.text;
  }

  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 4_000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `PROCEDURES: ${procedures.join(", ")}\n\nRESEARCH FINDINGS:\n${findings}`,
      },
    ],
    output_config: { format: zodOutputFormat(MarketFacts) },
  });

  const parsed = response.parsed_output as MarketFacts | null;
  if (!parsed) throw new Error(`market stats failed: stop_reason ${response.stop_reason}`);
  return parsed;
}
