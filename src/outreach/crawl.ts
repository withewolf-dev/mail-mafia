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

/**
 * Dated archive paths — `/2026/07/some-post/` and friends.
 *
 * Excluded by default because `limit` is a stop condition, not a ranking: a
 * practice with an active blog will spend the entire budget on articles before
 * reaching its own services pages. Ocala Plastic Surgery has 86 pages in its
 * sitemap and returned 18 blog posts out of 25.
 */
export const DEFAULT_EXCLUDE_PATHS = ["^/20\\d\\d/", "^/blog/20\\d\\d/", "^/(tag|category|author)/"];

export interface CrawlOptions {
  /** Pages to fetch. Each one is a credit. */
  limit?: number;
  /** Follow links onto subdomains and the whole domain, not just this path. */
  entireDomain?: boolean;
  /** Regex path patterns to skip. Defaults to dated archives. */
  excludePaths?: string[];
  /** Regex path patterns to restrict to. Overrides excludePaths when set. */
  includePaths?: string[];
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Firecrawl allows a few requests a minute and answers 429 past that, naming
 * the seconds to wait in the error body. A batch loop trips this immediately,
 * and the failure is invisible downstream — the site just looks uncrawlable.
 * Wait and retry rather than lose the site.
 */
const RATE_LIMIT_RETRIES = 4;

async function postWithBackoff(url: string, body: string): Promise<Response> {
  let wait = 12_000;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: authHeaders(),
      body,
    });
    if (response.status !== 429 || attempt >= RATE_LIMIT_RETRIES) return response;

    // The body says "please retry after Ns"; trust it when present.
    const text = await response.clone().text();
    const stated = Number(text.match(/retry after (\d+)s/i)?.[1]);
    const delay = Number.isFinite(stated) ? (stated + 2) * 1000 : wait;
    await new Promise((done) => setTimeout(done, delay));
    wait *= 2;
  }
}

/** Kick off the job. Returns the id to poll. */
export async function startCrawl(website: string, options: CrawlOptions = {}): Promise<string> {
  const response = await postWithBackoff(
    `${API}/crawl`,
    JSON.stringify({
      url: website,
      // Sitemap *and* link-following. "include" is the difference between
      // twenty pages and one on a site with no sitemap.
      sitemap: "include",
      crawlEntireDomain: options.entireDomain ?? false,
      limit: options.limit ?? 5,
      ...(options.includePaths?.length
        ? { includePaths: options.includePaths }
        : { excludePaths: options.excludePaths ?? DEFAULT_EXCLUDE_PATHS }),
      scrapeOptions: {
        onlyMainContent: true,
        maxAge: MAX_AGE_MS,
        parsers: ["pdf"],
        formats: ["markdown"],
      },
    }),
  );

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

export interface SearchHit {
  url: string;
  title: string;
  description: string;
}

/**
 * Firecrawl `/search` — Google results without scraping the pages. Used as the
 * search backend when SERPER_API_KEY isn't set.
 */
export async function searchFirecrawl(query: string, limit = 10): Promise<SearchHit[]> {
  const response = await fetch(`${API}/search`, {
    method: "POST",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: authHeaders(),
    body: JSON.stringify({ query, limit, sources: ["web"] }),
  });
  if (!response.ok) {
    throw new Error(`search failed: HTTP ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    data?: { web?: SearchHit[] } | SearchHit[];
  };
  // v2 keys results by source; v1 returned a bare array. Accept both.
  const items = Array.isArray(payload.data) ? payload.data : (payload.data?.web ?? []);
  return items.filter((item) => item.url);
}

/**
 * Fetch one page. Unlike `/crawl` this is a single request, so it's the cheap
 * way to read a result the snippet only teased.
 *
 * Returns null rather than throwing: a scrape failing is the normal case for
 * login walls and 403s, and one dead result should not sink the caller.
 */
export async function scrapePage(url: string): Promise<SourcePage | null> {
  try {
    const response = await fetch(`${API}/scrape`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: authHeaders(),
      body: JSON.stringify({
        url,
        onlyMainContent: true,
        maxAge: MAX_AGE_MS,
        formats: ["markdown"],
      }),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as { data?: CrawlDocument };
    const text = markdownToText(payload.data?.markdown ?? "");
    if (text.length < THIN_PAGE_CHARS) return null;
    return { url, title: payload.data?.metadata?.title ?? "", text };
  } catch {
    return null;
  }
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
 * Registrar parking pages. A domain that resolves is not a website: Rejuve You
 * Med Spa has 5.0 stars from 19 reviews and its domain is a GoDaddy lander, so
 * "site responded 200" tells you nothing on its own.
 *
 * `_trfd` must not be a marker: it is GoDaddy's traffic snippet and appears on
 * every GoDaddy-built site, parked or live (vitalitymedicine.net, a real
 * business, was mislabelled parked by it). GoDaddy parking is caught by
 * `parking-lander` and `ap: "parking"` instead.
 */
const PARKED_MARKERS =
  /(parking-lander|ap:\s*"parking"|sedoparking|afternic|domain(name)?[-_ ]?(is[-_ ])?for[-_ ]sale|hugedomains|bodis\.com|parkingcrew)/i;

export type SiteStatus = "ok" | "parked" | "unreachable" | "empty";

/**
 * Cheap pre-flight, before spending a single credit.
 *
 * One plain HTTP request tells you whether a crawl is worth starting. Parked
 * domains are common in Google Maps exports — the listing is real, the website
 * field is a registrar placeholder — and crawling one burns credits to learn
 * nothing.
 */
export async function checkSite(website: string, timeoutMs = 15_000): Promise<SiteStatus> {
  let html: string;
  let finalUrl: string;
  try {
    const response = await fetch(website, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; mail-mafia/0.1)" },
      redirect: "follow",
    });
    if (!response.ok) return "unreachable";
    html = await response.text();
    finalUrl = response.url;
  } catch {
    return "unreachable";
  }

  if (PARKED_MARKERS.test(html)) return "parked";

  // A body-less shell that only redirects. Follow it once before judging: this
  // is exactly the shape of a parked homepage, and also of a real site that
  // bounces to /home.
  const redirect = html.match(/location\.href\s*=\s*["']([^"']+)["']/);
  if (redirect && html.length < 2000) {
    try {
      const target = new URL(redirect[1]!, finalUrl).toString();
      const followed = await fetch(target, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; mail-mafia/0.1)" },
      });
      const body = await followed.text();
      if (PARKED_MARKERS.test(body)) return "parked";
      if (body.replace(/<[^>]+>/g, " ").trim().length < 200) return "empty";
    } catch {
      return "unreachable";
    }
  }

  return "ok";
}

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
    // Firecrawl will scrape sitemap.xml as a document when the pages it lists
    // can't be reached. A long sitemap clears the length floor and arrives at
    // the extractor looking like prose, so drop feeds by extension.
    if (/\.(xml|rss|atom|json|txt)(\?|$)/i.test(url)) continue;

    const key = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    pages.push({ url, title: doc.metadata?.title ?? "", text });
  }

  return pages.sort((a, b) => b.text.length - a.text.length);
}
