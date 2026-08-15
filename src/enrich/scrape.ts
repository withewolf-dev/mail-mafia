/** Junk that matches an email regex but isn't a contact address. */
const NOT_A_CONTACT = /(sentry|wixpress|example\.|\.png|\.jpg|\.webp|godaddy|squarespace|@2x)/i;

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Enough for the model to find something specific; more is wasted tokens. */
const MAX_SITE_CHARS = 6000;

export interface SiteContent {
  /** Visible text, stripped of markup. Raw material for the opener. */
  text: string;
  /** Best contact address found, preferring one on their own domain. */
  email: string;
  emailSource: "domain" | "scraped" | "none";
}

export function extractFromHtml(html: string, domain: string): SiteContent {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SITE_CHARS);

  const found = (html.match(EMAIL_RE) ?? [])
    .map((e) => e.toLowerCase())
    .filter((e) => !NOT_A_CONTACT.test(e));

  // An address on their own domain is a real contact; a gmail.com found in a
  // footer widget usually isn't.
  const onDomain = found.filter((e) => e.endsWith(`@${domain}`));
  const email = onDomain[0] ?? found[0] ?? "";

  return {
    text,
    email,
    emailSource: email ? (onDomain[0] ? "domain" : "scraped") : "none",
  };
}

/**
 * Fetch a prospect's site. Never throws on a bad site — one Cloudflare 403
 * must not kill the batch, so failures come back as empty content and the
 * caller decides whether to skip.
 */
export async function scrapeSite(
  website: string,
  domain: string,
  timeoutMs = 10_000,
): Promise<SiteContent> {
  try {
    const response = await fetch(website, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; mail-mafia/0.1)" },
      redirect: "follow",
    });
    if (!response.ok) return { text: "", email: "", emailSource: "none" };
    return extractFromHtml(await response.text(), domain);
  } catch {
    return { text: "", email: "", emailSource: "none" };
  }
}
