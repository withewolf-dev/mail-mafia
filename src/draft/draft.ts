import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv } from "../env.js";

const MODEL = "claude-sonnet-5";

/**
 * Claude fills exactly two slots. Everything else in the email is fixed
 * template — variance across hundreds of sends is where deliverability and
 * credibility die, and a free-writing model will eventually invent a claim
 * about a medical clinic.
 */
export const DraftSlots = z.object({
  subject: z.string(),
  opener: z.string(),
});
export type DraftSlots = z.infer<typeof DraftSlots>;

const SYSTEM = `You write cold outreach openers for Armstrong, an AI-search visibility service.

RULES:
- subject: 3-6 words, lowercase, no colon, no question mark. Never use: quick question, boosting, unlock, elevate, transform, AI-powered, growth hack.
- opener: ONE sentence, max 22 words, naming something SPECIFIC and TRUE from their website. An observation, not a compliment. Never invent facts.

If the website text is too thin to say anything specific and true, write an
opener about their category and city rather than inventing a detail.`;

export interface DraftInput {
  name: string;
  category: string;
  city: string;
  rating?: number;
  reviewCount?: number;
  /** Scraped site text. The opener's only source of specifics. */
  siteText: string;
}

let client: Anthropic | undefined;
const getClient = (): Anthropic =>
  (client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") }));

export const MAX_OPENER_WORDS = 22;
export const SUBJECT_WORD_RANGE = [3, 6] as const;

/** Words the subject must never contain — they read as marketing spam. */
const BANNED_SUBJECT_WORDS = [
  "quick question",
  "boosting",
  "unlock",
  "elevate",
  "transform",
  "ai-powered",
  "growth hack",
];

export const countWords = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * The prompt states these rules and the model still breaks them — the first
 * live draft came back at 28 words against a 22-word limit. Same principle as
 * the reply classifier's confidence floor: enforce in code, not in the prompt.
 */
export function violations(slots: DraftSlots): string[] {
  const problems: string[] = [];
  const openerWords = countWords(slots.opener);
  const subjectWords = countWords(slots.subject);
  const [minSubject, maxSubject] = SUBJECT_WORD_RANGE;

  if (openerWords > MAX_OPENER_WORDS) {
    problems.push(`opener is ${openerWords} words, max is ${MAX_OPENER_WORDS}`);
  }
  if (subjectWords < minSubject || subjectWords > maxSubject) {
    problems.push(`subject is ${subjectWords} words, must be ${minSubject}-${maxSubject}`);
  }
  if (slots.subject !== slots.subject.toLowerCase()) {
    problems.push("subject must be lowercase");
  }
  if (/[:?]/.test(slots.subject)) {
    problems.push("subject must not contain a colon or question mark");
  }
  for (const banned of BANNED_SUBJECT_WORDS) {
    if (slots.subject.toLowerCase().includes(banned)) {
      problems.push(`subject contains banned phrase "${banned}"`);
    }
  }
  return problems;
}

export class DraftRejected extends Error {
  constructor(readonly problems: string[], readonly slots: DraftSlots) {
    super(`Draft still broke the rules after a retry: ${problems.join("; ")}`);
    this.name = "DraftRejected";
  }
}

export async function draftSlots(input: DraftInput): Promise<DraftSlots> {
  const user = [
    `BUSINESS: ${input.name}`,
    `CATEGORY: ${input.category}`,
    `CITY: ${input.city}`,
    `RATING: ${input.rating ?? "?"} (${input.reviewCount ?? "?"} reviews)`,
    "",
    "WEBSITE TEXT:",
    input.siteText,
  ].join("\n");

  let slots = await callModel(user);
  let problems = violations(slots);
  if (problems.length === 0) return slots;

  // One correction pass, naming the exact breach. Cheaper than shipping an
  // off-spec email and far cheaper than a human rewriting it.
  slots = await callModel(
    `${user}\n\nYour previous attempt broke these rules: ${problems.join("; ")}.\n` +
      `Previous opener: "${slots.opener}"\nRewrite it to comply. Keep it specific and true.`,
  );
  problems = violations(slots);
  if (problems.length > 0) throw new DraftRejected(problems, slots);
  return slots;
}

async function callModel(user: string): Promise<DraftSlots> {
  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(DraftSlots) },
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Draft failed: model returned no structured output.");
  return parsed;
}

/**
 * The fixed body. Only `opener` varies between prospects, plus the merge
 * fields — everything else is identical on every send by design.
 */
export function assembleBody(input: DraftInput, slots: DraftSlots): string {
  const first = input.name.split(/[\s,]/)[0] ?? input.name;

  return `Hi ${first} team,

${slots.opener}

I ran a check on how AI search engines answer "best ${input.category} in ${input.city}". ${input.name} is not being named in those answers - competitors are.

That is a structure and citation-sourcing problem, not an ads problem. We rebuild how AI models read a business so it gets cited in the answer itself.

Want the 12-query breakdown showing exactly where you are invisible? Free, takes me ten minutes.

Danish
Armstrong - armstrongco.ai`;
}

export interface Draft {
  subject: string;
  opener: string;
  body: string;
}

export async function draftEmail(input: DraftInput): Promise<Draft> {
  const slots = await draftSlots(input);
  return { ...slots, body: assembleBody(input, slots) };
}
