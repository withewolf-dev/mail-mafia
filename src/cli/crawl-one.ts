/**
 * Crawl one site with Firecrawl and write the pages to crawl-sites/<domain>/.
 *
 *   npx tsx src/cli/crawl-one.ts bornagaindoctor.com
 *   npx tsx src/cli/crawl-one.ts bornagaindoctor.com --limit 25
 *   npx tsx src/cli/crawl-one.ts <url> --force     # crawl even if it looks parked
 *
 * Costs one credit per page. Overwrites whatever was there for that domain.
 */
import "../env.js";
import { checkSite, crawlPages, hasFirecrawlKey } from "../outreach/crawl.js";
import { savePages } from "../outreach/store.js";
import { recordRemark, remarkFor } from "../outreach/remarks.js";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
const force = args.includes("--force");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 10;

if (!target) {
  console.error("usage: npx tsx src/cli/crawl-one.ts <url> [--limit N] [--force]");
  process.exit(1);
}
if (!hasFirecrawlKey()) {
  console.error("FIRECRAWL_API_KEY is not set. See .env.example.");
  process.exit(1);
}

const website = /^https?:\/\//.test(target) ? target : `https://${target}`;
const domain = new URL(website).hostname.replace(/^www\./, "");

/** Note what we found against the prospect row, when there is one. */
async function note(remark: string): Promise<void> {
  const updated = await recordRemark(domain, remark);
  console.log(updated ? `remark: ${remark}` : `remark: ${remark}  (no prospect row for ${domain})`);
}

// One free request before any paid ones.
const status = await checkSite(website);
if (status !== "ok" && !force) {
  console.log(`${website} — ${status}. No crawl started, no credits spent.`);
  await note(remarkFor(status, []));
  console.log("Pass --force to crawl it anyway.");
  process.exit(0);
}

const pages = await crawlPages(website, {
  limit,
  onProgress: (completed, total) => process.stdout.write(`\r  crawling ${completed}/${total}   `),
});
process.stdout.write("\r".padEnd(40) + "\r");

// Store under the domain the pages actually came from, not the one we typed.
// ocalaplasticsurgery.com/aqua-med-spa/ redirects to aquamedspaocala.com, and
// keying on the input silently overwrote the parent practice's folder with the
// med spa's pages.
let storedUnder = domain;
try {
  const landed = new URL(pages[0]!.url).hostname.replace(/^www\./, "");
  if (landed && landed !== domain) {
    console.log(`redirected: ${domain} -> ${landed}. Storing under ${landed}.`);
    storedUnder = landed;
  }
} catch {
  /* no pages, or an unparsable url — keep the input domain */
}

const dir = await savePages(storedUnder, pages);
await note(remarkFor(status, pages));

console.log(`${pages.length} page(s) -> ${dir}\n`);
for (const page of pages) {
  console.log(`${String(page.text.length).padStart(6)} chars  ${page.url}`);
}
console.log(`\ntotal ${pages.reduce((sum, p) => sum + p.text.length, 0).toLocaleString()} chars`);
