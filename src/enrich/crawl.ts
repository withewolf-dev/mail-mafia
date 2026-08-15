import { extractFromHtml, type SiteContent } from "./scrape.js";

/**
 * Pages worth reading, in priority order. A homepage is usually navigation;
 * the substance a good opener needs lives on these.
 */
const WANTED = [
  /about/i,
  /our-(story|team|practice|philosophy)/i,
  /who-we-are/i,
  /services|treatments|procedures/i,
  /team|staff|doctors|providers/i,
  /why-(us|choose)/i,
];

/** Never follow these — no useful prose, and some are bot traps. */
const AVOID =
  /(\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4)$|\/(blog|news|privacy|terms|cart|checkout|login|account|booking|appointment)\b|^mailto:|^tel:|#)/i;

const MAX_PAGES = 4;
const MAX_TOTAL_CHARS = 12_000;
const PER_PAGE_TIMEOUT_MS = 10_000;

async function getHtml(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PER_PAGE_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; mail-mafia/0.1)" },
      redirect: "follow",
    });
    return response.ok ? await response.text() : "";
  } catch {
    return "";
  }
}

/** Same-site links only — we want their words, not a partner's. */
export function pickLinks(html: string, baseUrl: string, limit = MAX_PAGES - 1): string[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const scored: { url: string; rank: number }[] = [];

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const raw = match[1]!;
    if (AVOID.test(raw)) continue;

    let url: URL;
    try {
      url = new URL(raw, base);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;

    url.hash = "";
    const clean = url.toString();
    if (clean === baseUrl || seen.has(clean)) continue;

    const rank = WANTED.findIndex((re) => re.test(url.pathname));
    if (rank === -1) continue; // only follow pages we actually want

    seen.add(clean);
    scored.push({ url: clean, rank });
  }

  return scored
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((s) => s.url);
}

export interface CrawlResult extends SiteContent {
  /** Pages that returned usable text, in the order they were read. */
  pagesRead: string[];
}

/**
 * Read the homepage, then the most promising internal pages, and concatenate.
 * Never throws: a dead site returns empty text and the caller decides.
 */
export async function crawlSite(website: string, domain: string): Promise<CrawlResult> {
  const homeHtml = await getHtml(website);
  if (!homeHtml) return { text: "", email: "", emailSource: "none", pagesRead: [] };

  const home = extractFromHtml(homeHtml, domain);
  const parts = [home.text];
  const pagesRead = [website];
  let email = home.email;
  let emailSource = home.emailSource;

  for (const link of pickLinks(homeHtml, website)) {
    if (parts.join(" ").length >= MAX_TOTAL_CHARS) break;
    const html = await getHtml(link);
    if (!html) continue;

    const page = extractFromHtml(html, domain);
    if (page.text.length < 200) continue; // a shell page adds noise, not signal

    parts.push(page.text);
    pagesRead.push(link);

    // A contact address on a deeper page is often better than the homepage's.
    if (page.emailSource === "domain" && emailSource !== "domain") {
      email = page.email;
      emailSource = "domain";
    } else if (!email && page.email) {
      email = page.email;
      emailSource = page.emailSource;
    }
  }

  return {
    text: parts.join("\n\n").slice(0, MAX_TOTAL_CHARS),
    email,
    emailSource,
    pagesRead,
  };
}
