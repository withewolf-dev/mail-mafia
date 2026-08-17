import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { requireEnv } from "../env.js";
import { searchWeb } from "../harvest/serper.js";
import { hasFirecrawlKey, scrapePage, searchFirecrawl } from "./crawl.js";
import { lookupPractitioner } from "./doh.js";

/** Pages to open per prospect when snippets come up short. Each is a credit. */
const DEEP_READ_PAGES = 3;

/** Enough of a registry or contact page to hold the address; past this it's nav. */
const DEEP_READ_CHARS = 12_000;

const MODEL = "claude-sonnet-5";

let client: Anthropic | undefined;
const getClient = (): Anthropic =>
  (client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") }));

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

interface SearchOutcome {
  hits: SearchHit[];
  knowledgeGraph?: Record<string, unknown>;
}

/** Serper when its key is set (matches the n8n harvest), Firecrawl otherwise. */
async function runSearch(query: string): Promise<SearchOutcome> {
  if (process.env.SERPER_API_KEY) {
    const result = await searchWeb(query);
    return {
      hits: result.organic.map((r) => ({
        title: r.title ?? "",
        url: r.link ?? "",
        snippet: r.snippet ?? "",
      })),
      knowledgeGraph: result.knowledgeGraph,
    };
  }
  if (hasFirecrawlKey()) {
    const hits = await searchFirecrawl(query);
    return { hits: hits.map((h) => ({ title: h.title, url: h.url, snippet: h.description })) };
  }
  throw new Error("Neither SERPER_API_KEY nor FIRECRAWL_API_KEY is set. See .env.example.");
}

const resultsBlock = (results: SearchOutcome): string =>
  [
    results.knowledgeGraph
      ? `KNOWLEDGE PANEL:\n${JSON.stringify(results.knowledgeGraph, null, 2)}`
      : "KNOWLEDGE PANEL: none.",
    "",
    `RESULTS (${results.hits.length}):`,
    ...results.hits.map(
      (r, i) => `[${i + 1}] ${r.title || "(no title)"}\n    ${r.url}\n    ${r.snippet}`,
    ),
  ].join("\n");

/**
 * Login walls and paywalls. Scraping these spends a credit to be told no —
 * their snippets are all we will ever get.
 */
const UNREADABLE = /(facebook|instagram|linkedin|zoominfo|rocketreach|apollo\.io|x\.com)\b/i;

/**
 * Open the top results and return their text.
 *
 * A snippet is ~160 characters chosen by Google to match the query, not to
 * carry a contact detail: the NPI registry page that names an owner, and the
 * DOH licence record that prints an email, both get truncated long before the
 * useful line. This is what Google's AI Overview does that the search API does
 * not — it reads the pages.
 */
async function deepRead(hits: SearchHit[]): Promise<string> {
  if (!hasFirecrawlKey()) return "";

  const targets = hits.filter((h) => h.url && !UNREADABLE.test(h.url)).slice(0, DEEP_READ_PAGES);
  const pages = (await Promise.all(targets.map((h) => scrapePage(h.url)))).filter(
    (p): p is NonNullable<typeof p> => p !== null,
  );
  if (!pages.length) return "";

  return [
    "",
    `FULL PAGE TEXT (${pages.length} result page(s) opened and read):`,
    ...pages.map((p) => `--- ${p.url}\n${p.text.slice(0, DEEP_READ_CHARS)}`),
  ].join("\n");
}

async function extract<T>(schema: z.ZodType<T>, system: string, user: string): Promise<T> {
  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 8_000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(schema as never) },
  });
  const parsed = response.parsed_output as T | null;
  if (!parsed) throw new Error(`extraction failed: stop_reason ${response.stop_reason}`);
  return parsed;
}

const OwnerName = z.object({
  firstName: z.string().nullable().describe("Owner's first name, or null if the results never name one."),
  lastName: z.string().nullable().describe("Owner's last name, or null."),
  role: z
    .string()
    .nullable()
    .describe('How the results describe them: "owner", "founder", "medical director", etc.'),
  confidence: z
    .number()
    .describe("0 to 1. How sure you are this person owns or runs THIS business, not a namesake."),
  evidence: z
    .array(z.string())
    .describe("Each fact used, followed by the result URL it came from. One line each."),
});


export interface OwnerGuess {
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  email: string | null;
  nameConfidence: number;
  emailConfidence: number;
  evidence: string[];
  queries: string[];
  /** Whether any result page was opened, or this came from snippets alone. */
  pagesRead: boolean;
/** Where the address came from. Only the state registry counts; otherwise null. */
  emailSource: "fl-doh" | null;
}

/** Below this a name is an inference from context, not a stated fact. */
export const NAME_CONFIDENCE_FLOOR = 0.6;

const NAME_SYSTEM = [
  "You read Google search results for a small local business and identify its owner.",
  "",
  "HARD RULES:",
  "- Use ONLY what the results below state. If no result names an owner, return nulls.",
  "- Directory listings (Yelp, LinkedIn, state registries, health-department records) count",
  "  as sources; cite them.",
  "- A person merely mentioned near the business (a reviewer, a patient, a competitor)",
  "  is not the owner. Lower confidence when the tie is thin.",
].join("\n");


/**
 * The domain minus its TLD and www — "ocalaplasticsurgery".
 *
 * Google's spelling correction splits that into "ocala plastic surgery", which
 * is how the search becomes useful.
 */
export const domainRoot = (domain: string): string =>
  domain.replace(/^www\./, "").replace(/\.[a-z.]+$/i, "");

/**
 * Two searches, the way a human does it:
 *
 *   1. "<business name> owner"            -> who runs it
 *   2. "<business name> <owner> email"    -> an address for that person
 *
 * Each step is one search credit plus one small Claude call, reading only the
 * snippets. Step 2 is skipped when step 1 finds nobody. Emails only count when
 * they appear verbatim in a result; a guessed first@domain would poison the
 * send list with bounces, which is worse for deliverability than no email.
 *
 * Step 1 gets a second attempt on the domain root when the listing name finds
 * nobody. A satellite location is listed under its own name on Maps — "Aqua Med
 * Spa: The Villages Location" — while the ownership is filed under the parent
 * practice that owns the website, ocalaplasticsurgery.com. Searching the
 * listing name returns unrelated businesses that happen to share it; searching
 * the domain finds the company that actually exists on paper.
 */
export async function findOwner(
  domain: string,
  businessName: string,
  city?: string,
): Promise<OwnerGuess> {
  const nameQuery = `${businessName} owner`;
  const queries = [nameQuery];

  const nameResults = await runSearch(nameQuery);
  /** Whichever search last produced the results we are reasoning from. */
  let lastResults = nameResults;
  let pagesRead = false;
  let name = await extract(
    OwnerName,
    NAME_SYSTEM,
    [`BUSINESS: ${businessName}`, `DOMAIN: ${domain}`, "", resultsBlock(nameResults)].join("\n"),
  );

  if (!name.firstName && !name.lastName) {
    const root = domainRoot(domain);
    const fallbackQuery = `${root} owner`;
    queries.push(fallbackQuery);
    const fallbackResults = await runSearch(fallbackQuery);
    const fallback = await extract(
      OwnerName,
      NAME_SYSTEM,
      [
        `BUSINESS: ${businessName}`,
        `DOMAIN: ${domain}`,
        "",
        "NOTE: the listing name found nobody. These results are for the domain itself, which",
        "for a satellite location belongs to the PARENT practice. An owner of the parent is a",
        "valid answer — say so in the evidence and in the role.",
        "",
        resultsBlock(fallbackResults),
      ].join("\n"),
    );
    if (fallback.firstName || fallback.lastName) {
      name = fallback;
      lastResults = fallbackResults;
    }
  }

  // Snippets never print a title like "owner" for a practice whose ownership
  // lives in a registry record. Open the pages before giving up or settling
  // for a low-confidence inference.
  if (!name.firstName || name.confidence < NAME_CONFIDENCE_FLOOR) {
    const pages = await deepRead(lastResults.hits);
    if (pages) {
      pagesRead = true;
      const deeper = await extract(
        OwnerName,
        NAME_SYSTEM,
        [
          `BUSINESS: ${businessName}`,
          `DOMAIN: ${domain}`,
          "",
          "The search snippets were inconclusive. The full text of the top results follows —",
          "prefer it over the snippets, and cite the page URL.",
          pages,
        ].join("\n"),
      );
      if (deeper.firstName && deeper.confidence >= name.confidence) name = deeper;
    }
  }

  const guess: OwnerGuess = {
    firstName: name.firstName,
    lastName: name.lastName,
    role: name.role,
    email: null,
    nameConfidence: name.confidence,
    emailConfidence: 0,
    evidence: name.evidence,
    queries,
    pagesRead,
    emailSource: null,
  };

  guess.pagesRead = pagesRead;

  // A name we could not stand behind is worse than no name: it becomes the
  // greeting on a cold email addressed to a stranger. Same rule as
  // applyConfidenceFloor in the classifier — enforced here, not in the prompt.
  if (name.confidence < NAME_CONFIDENCE_FLOOR) {
    guess.evidence.push(
      `Name discarded: confidence ${name.confidence.toFixed(2)} is below the ` +
        `${NAME_CONFIDENCE_FLOOR} floor. Best inference was ` +
        `"${[name.firstName, name.lastName].filter(Boolean).join(" ") || "(none)"}".`,
    );
    guess.firstName = null;
    guess.lastName = null;
    guess.role = null;
    return guess;
  }

  if (!name.firstName || !name.lastName) return guess;

  // The ONLY email source. The practitioner filed this address with the state
  // themselves, so it is the one address we can say reaches this person.
  // Everything a web search turns up instead is a shared box — info@, the
  // spa's own inbox, a receptionist — which is not the owner's email and must
  // not be stored as one. No registry hit means null.
  const record = await lookupPractitioner(name.firstName, name.lastName, city);
  if (!record) {
    guess.evidence.push(`No FL DOH licence found for ${name.firstName} ${name.lastName}.`);
    return guess;
  }

  const detail = [record.profession, record.city, record.status].filter(Boolean).join(", ");
  guess.evidence.push(
    `FL DOH licence ${record.license}${detail ? ` (${detail})` : ""}` +
      `${record.name ? ` filed as ${record.name}` : ""} - ${record.detailUrl}`,
  );

  if (!record.email) {
    guess.evidence.push(`No email on file with FL DOH for licence ${record.license}.`);
    return guess;
  }

  guess.email = record.email;
  guess.emailConfidence = 0.95;
  guess.emailSource = "fl-doh";
  guess.evidence.push(`Email on file with FL DOH: ${record.email} - ${record.detailUrl}`);
  return guess;
}
