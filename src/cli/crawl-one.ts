/**
 * Crawl one site with Firecrawl and show what came back.
 *
 *   npx tsx src/cli/crawl-one.ts bornagaindoctor.com
 *   npx tsx src/cli/crawl-one.ts bornagaindoctor.com --limit 25
 *   npx tsx src/cli/crawl-one.ts bornagaindoctor.com --json
 *
 * Costs one credit per page. Writes nothing.
 */
import "../env.js";
import { crawlPages, hasFirecrawlKey } from "../outreach/crawl.js";

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
const asJson = args.includes("--json");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 10;

if (!target) {
  console.error("usage: npx tsx src/cli/crawl-one.ts <url> [--limit N] [--json]");
  process.exit(1);
}
if (!hasFirecrawlKey()) {
  console.error("FIRECRAWL_API_KEY is not set. See .env.example.");
  process.exit(1);
}

const website = /^https?:\/\//.test(target) ? target : `https://${target}`;

const pages = await crawlPages(website, {
  limit,
  onProgress: (completed, total) => process.stdout.write(`\r  crawling ${completed}/${total}   `),
});

process.stdout.write("\r".padEnd(40) + "\r");

if (asJson) {
  console.log(JSON.stringify(pages, null, 2));
} else {
  console.log(`${pages.length} page(s) with usable prose, richest first:\n`);
  for (const page of pages) {
    console.log(`${String(page.text.length).padStart(6)} chars  ${page.url}`);
    if (page.title) console.log(`               ${page.title.slice(0, 80)}`);
  }
  const total = pages.reduce((sum, p) => sum + p.text.length, 0);
  console.log(`\ntotal ${total.toLocaleString()} chars`);
}
