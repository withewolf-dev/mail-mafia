/**
 * Draft emails for every prospect that has both an email and a website, and
 * store them. Prints counts only — read the drafts from the database.
 *
 *   npx tsx src/cli/draft-batch.ts               # everything not yet drafted
 *   npx tsx src/cli/draft-batch.ts --limit 25
 *   npx tsx src/cli/draft-batch.ts --retry       # only previous failures
 *
 * Sends nothing. Safe to interrupt and re-run — drafted rows are skipped.
 */
import "../env.js";
import { db } from "../db/client.js";
import { scrapeSite } from "../enrich/scrape.js";
import { draftEmail } from "../draft/draft.js";

const args = process.argv.slice(2);
const retry = args.includes("--retry");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 500;
/** Modest: each task makes an outbound scrape plus one or two model calls. */
const CONCURRENCY = 5;

interface Row {
  id: number;
  name: string;
  city: string | null;
  category: string | null;
  website: string;
  domain: string;
  rating: number | null;
  review_count: number | null;
}

const q = db();

const rows = (await q`
  select id, name, city, category, website, domain, rating, review_count
    from prospects
   where email is not null
     and website is not null
     and ${retry ? q`draft_error is not null` : q`body is null`}
   order by id
   limit ${limit}`) as Row[];

console.log(`${rows.length} prospect(s) to draft, ${CONCURRENCY} at a time.`);

const counts = { drafted: 0, noSite: 0, failed: 0 };
let done = 0;

async function handle(row: Row): Promise<void> {
  try {
    const site = await scrapeSite(row.website, row.domain);
    if (!site.text) {
      counts.noSite++;
      await q`update prospects
                 set draft_error = 'site unreachable or empty', updated_at = now()
               where id = ${row.id}`;
      return;
    }

    const draft = await draftEmail(
      {
        name: row.name,
        // Blank rather than a guess — the model infers it from the site below.
        category: row.category ?? "",
        city: row.city ?? "",
        rating: row.rating ?? undefined,
        reviewCount: row.review_count ?? undefined,
        siteText: site.text,
      },
      // No category in the Maps exports, so let the model classify it.
      !row.category,
    );

    await q`update prospects
               set subject = ${draft.subject},
                   opener = ${draft.opener},
                   body = ${draft.body},
                   category = coalesce(prospects.category, ${draft.category}),
                   status = 'drafted',
                   drafted_at = now(),
                   draft_error = null,
                   updated_at = now()
             where id = ${row.id}`;
    counts.drafted++;
  } catch (e) {
    counts.failed++;
    await q`update prospects
               set draft_error = ${(e as Error).message.slice(0, 500)}, updated_at = now()
             where id = ${row.id}`;
  } finally {
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${rows.length}`);
  }
}

// Simple worker pool — keeps CONCURRENCY tasks in flight without a dependency.
const queue = [...rows];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) await handle(row);
  }),
);

console.log(
  `\ndrafted        : ${counts.drafted}\n` +
    `site unreachable : ${counts.noSite}\n` +
    `failed           : ${counts.failed}`,
);
