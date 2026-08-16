import "../env.js";

/** A page worth reading, however it was fetched. */
export interface SourcePage {
  url: string;
  title: string;
  /** Rendered prose, markup stripped. */
  text: string;
}

/**
 * Firecrawl `/crawl` — discovery and rendering in one job.
 *
 * Preferred over `/map` + `/scrape` because map leans on a sitemap and quietly
 * returns almost nothing when a site doesn't publish one: bornagaindoctor.com
 * maps to a single URL while its homepage links to twenty real pages. Crawl
 * follows links as well as the sitemap, so a WordPress site with no sitemap
 * still comes back whole.
 *
 * The trade is that it's a job, not a request. POST returns an id; the pages
 * arrive from polling.
 */
const API = "https://api.firecrawl.dev/v2";

/** Two days. A clinic's service pages do not change inside that. */
const MAX_AGE_MS = 172_800_000;

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 30_000;

export const hasFirecrawlKey = (): boolean => Boolean(process.env.FIRECRAWL_API_KEY);

/** Never accept the key as an argument — it belongs in the environment only. */
function authHeaders(): Record<string, string> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY is not set. See .env.example.");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

interface CrawlDocument {
  markdown?: string;
  metadata?: { title?: string; sourceURL?: string; url?: string; statusCode?: number };
}

export interface CrawlOptions {
  /** Pages to fetch. Each one is a credit. */
  limit?: number;
  /** Follow links onto subdomains and the whole domain, not just this path. */
  entireDomain?: boolean;
  onProgress?: (completed: number, total: number) => void;
}

/** Kick off the job. Returns the id to poll. */
export async function startCrawl(website: string, options: CrawlOptions = {}): Promise<string> {
  const response = await fetch(`${API}/crawl`, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: authHeaders(),
    body: JSON.stringify({
      url: website,
      // Sitemap *and* link-following. "include" is the difference between
      // twenty pages and one on a site with no sitemap.
      sitemap: "include",
      crawlEntireDomain: options.entireDomain ?? false,
      limit: options.limit ?? 10,
      scrapeOptions: {
        onlyMainContent: true,
        maxAge: MAX_AGE_MS,
        parsers: ["pdf"],
        formats: ["markdown"],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`crawl start failed: HTTP ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { success?: boolean; id?: string; error?: string };
  if (!payload.id) throw new Error(`crawl start returned no id: ${payload.error ?? "unknown"}`);
  return payload.id;
}

/** Poll until the job finishes, following pagination. */
export async function collectCrawl(
  jobId: string,
  onProgress?: CrawlOptions["onProgress"],
): Promise<CrawlDocument[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const documents: CrawlDocument[] = [];
  let next: string | undefined = `${API}/crawl/${jobId}`;

  while (next) {
    if (Date.now() > deadline) throw new Error(`crawl ${jobId} timed out after ${POLL_TIMEOUT_MS}ms`);

    const response = await fetch(next, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error(`crawl poll failed: HTTP ${response.status}`);

    const payload = (await response.json()) as {
      status?: string;
      total?: number;
      completed?: number;
      data?: CrawlDocument[];
      next?: string;
    };

    onProgress?.(payload.completed ?? 0, payload.total ?? 0);

    if (payload.status === "failed" || payload.status === "cancelled") {
      throw new Error(`crawl ${jobId} ${payload.status}`);
    }

    if (payload.status === "completed") {
      documents.push(...(payload.data ?? []));
      // A completed job can still paginate; `next` is absent on the last page.
      next = payload.next;
      continue;
    }

    // Still scraping. Don't accumulate partials — a re-poll resends them.
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return documents;
}

/** Markdown syntax is navigation noise once the prose is what we want. */
export function markdownToText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*\-+]\s*/gm, " ")
    .replace(/[|`_*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Below this a page is a card grid or a nav shell, not material. */
export const THIN_PAGE_CHARS = 120;

/**
 * Crawl a site and return the pages worth reading, richest first.
 *
 * Ordering matters downstream: the extractor gets a character budget, and on
 * these sites one page carries real prose while two dozen are card grids. Sort
 * by substance so the budget is spent on the page that has something in it.
 */
export async function crawlPages(
  website: string,
  options: CrawlOptions = {},
): Promise<SourcePage[]> {
  const jobId = await startCrawl(website, options);
  const documents = await collectCrawl(jobId, options.onProgress);

  const seen = new Set<string>();
  const pages: SourcePage[] = [];

  for (const doc of documents) {
    const url = doc.metadata?.sourceURL ?? doc.metadata?.url ?? "";
    const text = markdownToText(doc.markdown ?? "");
    if (!url || text.length < THIN_PAGE_CHARS) continue;

    const key = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    pages.push({ url, title: doc.metadata?.title ?? "", text });
  }

  return pages.sort((a, b) => b.text.length - a.text.length);
}
