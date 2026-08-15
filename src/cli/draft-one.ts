/**
 * Draft one email for one business, end to end: scrape -> Claude -> template.
 * Prints it; sends nothing.
 *
 *   npx tsx src/cli/draft-one.ts https://glowmedspa.ae "Glow Med Spa" "med spa" "Dubai"
 *
 * Use this to read 20 generated bodies before wiring the sender to it — step 2
 * of the test order in n8n_replication_guide.md.
 */
import "../env.js";
import { domainOf } from "../harvest/qualify.js";
import { scrapeSite } from "../enrich/scrape.js";
import { draftEmail } from "../draft/draft.js";

const [website, name, category, city] = process.argv.slice(2);
if (!website || !name || !category || !city) {
  console.error(
    'usage: npx tsx src/cli/draft-one.ts <website> "<name>" "<category>" "<city>"',
  );
  process.exit(1);
}

const domain = domainOf(website);
if (!domain) {
  console.error(`Not a usable URL: ${website}`);
  process.exit(1);
}

const site = await scrapeSite(website, domain);
console.log(
  `scraped ${site.text.length} chars from ${domain}` +
    (site.email ? `  ·  email: ${site.email} (${site.emailSource})` : "  ·  no email found"),
);

if (!site.text) {
  console.error("\nNothing scraped — the site blocked us or timed out. Skipping the draft.");
  process.exit(1);
}

const draft = await draftEmail({ name, category, city, siteText: site.text });

console.log(
  [
    "",
    "────────────────────────────────────────────────────",
    `Subject: ${draft.subject}`,
    "",
    draft.body,
    "────────────────────────────────────────────────────",
    `opener: ${draft.opener.split(/\s+/).length} words (max 22)`,
  ].join("\n"),
);
