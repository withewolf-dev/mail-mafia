/**
 * Draft (or re-read) the email for one prospect, pulled from Neon.
 *
 *   npx tsx src/cli/draft-one.ts chelsea@pdcsmile.com    # by email
 *   npx tsx src/cli/draft-one.ts pdcsmile.com            # by domain
 *   npx tsx src/cli/draft-one.ts 137                     # by id
 *   npx tsx src/cli/draft-one.ts <ref> --redraft         # ignore the stored draft
 *   npx tsx src/cli/draft-one.ts <ref> --redraft --save  # and write it back
 *
 * Sends nothing. CSVs are only an import format — everything downstream reads
 * the database.
 */
import "../env.js";
import { db } from "../db/client.js";
import { scrapeSite } from "../enrich/scrape.js";
import { draftEmail } from "../draft/draft.js";

const args = process.argv.slice(2);
const ref = args.find((a) => !a.startsWith("--"));
const redraft = args.includes("--redraft");
const save = args.includes("--save");

if (!ref) {
  console.error("usage: npx tsx src/cli/draft-one.ts <email | domain | id> [--redraft] [--save]");
  process.exit(1);
}

interface Row {
  id: number;
  name: string;
  city: string | null;
  region: string | null;
  category: string | null;
  email: string | null;
  website: string | null;
  domain: string | null;
  rating: number | null;
  review_count: number | null;
  subject: string | null;
  body: string | null;
  draft_error: string | null;
}

const q = db();
const id = /^\d+$/.test(ref) ? Number(ref) : null;

const [row] = (await q`
  select id, name, city, region, category, email, website, domain,
         rating, review_count, subject, body, draft_error
    from prospects
   where ${id !== null ? q`id = ${id}` : q`email = ${ref} or domain = ${ref}`}
   limit 1`) as Row[];

if (!row) {
  console.error(`No prospect matching "${ref}".`);
  process.exit(1);
}

console.log(
  `${row.name}  ·  ${row.city ?? "?"} ${row.region ?? ""}  ·  ` +
    `${row.rating ?? "?"}★ ${row.review_count ?? "?"} reviews\n` +
    `to: ${row.email ?? "(no email)"}   site: ${row.website ?? "(none)"}`,
);

// Stored draft, unless asked for a fresh one.
if (row.body && !redraft) {
  console.log(`\nSubject: ${row.subject}\n\n${row.body}`);
  console.log("\n(stored draft — pass --redraft to generate a new one)");
  process.exit(0);
}

if (!row.website || !row.domain) {
  console.error(`\nNo website on this row, so there is nothing to personalise from.`);
  if (row.draft_error) console.error(`last error: ${row.draft_error}`);
  process.exit(1);
}

const site = await scrapeSite(row.website, row.domain);
console.log(`\nscraped ${site.text.length} chars from ${row.domain}`);
if (!site.text) {
  console.error("Nothing came back — the site blocked us or timed out.");
  process.exit(1);
}

const draft = await draftEmail(
  {
    name: row.name,
    category: row.category ?? "",
    city: row.city ?? "",
    rating: row.rating ?? undefined,
    reviewCount: row.review_count ?? undefined,
    siteText: site.text,
  },
  !row.category,
);

console.log(`\nSubject: ${draft.subject}\n\n${draft.body}`);
console.log(`\ncategory: ${draft.category}   opener: ${draft.opener.split(/\s+/).length} words`);

if (save) {
  await q`update prospects
             set subject = ${draft.subject}, opener = ${draft.opener}, body = ${draft.body},
                 category = coalesce(prospects.category, ${draft.category}),
                 status = 'drafted', drafted_at = now(), draft_error = null, updated_at = now()
           where id = ${row.id}`;
  console.log("saved to the database.");
}
