import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv } from "../env.js";
import type { OverviewCapture } from "./browser.js";

const MODEL = "claude-sonnet-5";

let client: Anthropic | undefined;
const getClient = (): Anthropic =>
  (client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") }));

export const OverviewFacts = z.object({
  ownerFirstName: z.string().nullable().describe("First name of whoever the Overview calls the owner."),
  ownerLastName: z.string().nullable().describe("Their last name."),
  ownerRole: z
    .string()
    .nullable()
    .describe('The exact words the Overview uses: "owner and lead physician", "medical director".'),
  email: z
    .string()
    .nullable()
    .describe("An email address shown in the Overview, copied exactly. Null if none is shown."),
  otherPeople: z
    .array(z.string())
    .describe(
      "Anyone else named, with the role given. The Overview often names a second person in a " +
        "different role, and that distinction matters.",
    ),
  citedSources: z
    .array(z.string())
    .describe("The source chips shown under the answer, e.g. 'NPI Registry (.gov)', 'floriderm.com'."),
  confidence: z
    .number()
    .describe(
      "0 to 1: how plainly the Overview states this, not whether you believe it. A hedged or " +
        "self-contradicting answer scores low.",
    ),
  verbatim: z
    .string()
    .describe("The Overview's own opening sentences, transcribed exactly, for the record."),
});
export type OverviewFacts = z.infer<typeof OverviewFacts>;

const SYSTEM = [
  "You read a screenshot of a Google AI Overview and transcribe what it claims.",
  "",
  "You are a transcriber, not a judge:",
  "- Report what the Overview SAYS, even if it looks wrong. Downstream code weighs it against",
  "  other sources; your job is to capture the claim faithfully.",
  "- Copy names and email addresses character-for-character from the image. Never complete a",
  "  partly visible address, and never infer one from a name.",
  "- If the Overview gives one person the owner title and another a different title, put the",
  "  owner in ownerFirstName/ownerLastName and the other in otherPeople with their role.",
  "- Anything cut off at the edge of the image is not readable. Leave it out.",
].join("\n");

/**
 * Turn a captured Overview into fields.
 *
 * Reads the screenshot rather than the scraped text on purpose: the rendered
 * panel carries the citation chips and the visual hierarchy between the answer
 * and its bullet list, which flatten out of `innerText`. The extracted text is
 * supplied too, as a second look at the same thing.
 */
export async function readOverview(capture: OverviewCapture): Promise<OverviewFacts> {
  if (!capture.screenshotPath) throw new Error("No screenshot to read.");
  const image = await readFile(capture.screenshotPath);

  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 8_000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: image.toString("base64") },
          },
          {
            type: "text",
            text: [
              `SEARCH QUERY: ${capture.query}`,
              "",
              capture.text
                ? `TEXT AS RENDERED (same panel, for cross-checking the image):\n${capture.text.slice(0, 4000)}`
                : "TEXT AS RENDERED: unavailable — read the image only.",
            ].join("\n"),
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(OverviewFacts) },
  });

  const parsed = response.parsed_output as OverviewFacts | null;
  if (!parsed) throw new Error(`overview read failed: stop_reason ${response.stop_reason}`);
  return parsed;
}
