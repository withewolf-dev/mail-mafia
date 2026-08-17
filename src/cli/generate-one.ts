/**
 * Write the email for one prospect from the pages already stored on disk.
 *
 *   npx tsx src/cli/generate-one.ts aquamedspaocala.com
 *   npx tsx src/cli/generate-one.ts 3                     # by prospect id
 *   npx tsx src/cli/generate-one.ts <ref> --domain aquamedspaocala.com
 *
 * Reads crawl-sites/<domain>/*.md plus offer.md and skeleton.md. Crawls
 * nothing, sends nothing, writes nothing.
 */
import "../env.js";
import { db } from "../db/client.js";
import { generateEmail, type ProspectFacts } from "../outreach/generate.js";
import { listSites } from "../outreach/store.js";

const args = process.argv.slice(2);
const ref = args.find((a) => !a.startsWith("--"));
const domainArg = args.indexOf("--domain");
const overrideDomain = domainArg >= 0 ? args[domainArg + 1] : undefined;

if (!ref) {
  console.error("usage: npx tsx src/cli/generate-one.ts <domain | prospect id> [--domain <folder>]");
  console.error(`stored: ${(await listSites()).join(", ") || "(nothing crawled yet)"}`);
  process.exit(1);
}

interface Row {
  id: number;
  name: string;
  domain: string | null;
  city: string | null;
  region: string | null;
  category: string | null;
  rating: string | null;
  review_count: number | null;
}

const q = db();
const id = /^\d+$/.test(ref) ? Number(ref) : null;

const [row] = (await q`
  select id, name, domain, city, region, category, rating, review_count
    from prospects
   where ${id !== null ? q`id = ${id}` : q`domain = ${ref}`}
   limit 1`) as Row[];

// The folder can differ from the prospect's domain — aqua-med-spa redirects to
// its own site — so the override exists and is worth showing when it is used.
const domain = overrideDomain ?? row?.domain ?? ref;

const prospect: ProspectFacts = row
  ? {
      name: row.name,
      city: row.city ?? "",
      region: row.region ?? "",
      category: row.category,
      rating: row.rating ? Number(row.rating) : undefined,
      reviewCount: row.review_count ?? undefined,
    }
  : { name: ref, city: "", region: "", category: null };

if (!row) console.log(`no prospect row for "${ref}" — generating from pages alone.\n`);

console.log(`${prospect.name}${prospect.city ? ` — ${prospect.city}, ${prospect.region}` : ""}`);
console.log(`pages: crawl-sites/${domain}/\n`);

const { email, pagesUsed } = await generateEmail(domain, prospect);

console.log("=".repeat(72));
console.log("SUBJECT OPTIONS");
for (const subject of email.subjects) console.log(`  ${subject}`);
console.log("=".repeat(72));
console.log(`\n${email.body}\n`);
console.log("=".repeat(72));
console.log(`EVIDENCE — check each claim against its page (${pagesUsed.length} pages read)`);
for (const item of email.evidenceUsed) console.log(`  - ${item}`);
if (email.notSaid.length) {
  console.log("\nDROPPED — wanted to claim, but the pages did not support it");
  for (const item of email.notSaid) console.log(`  - ${item}`);
}
