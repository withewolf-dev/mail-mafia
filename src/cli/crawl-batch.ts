/**
 * Crawl every prospect that still needs pages, so the drafter has material.
 *
 *   npx tsx src/cli/crawl-batch.ts               # everything eligible, 5 pages each
 *   npx tsx src/cli/crawl-batch.ts --limit 25    # deeper crawl per site
 *   npx tsx src/cli/crawl-batch.ts --only 4 9    # specific prospects
 *
 * Eligible means: has a domain, has an owner name, not excluded or suppressed,
 * and nothing on disk yet. Costs one Firecrawl credit per page.
 */
import "../env.js";
import { db } from "../db/client.js";
import { checkSite, crawlPages, hasFirecrawlKey } from "../outreach/crawl.js";
import { listSites, savePages } from "../outreach/store.js";
import { recordRemark, remarkFor } from "../outreach/remarks.js";

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
// Five pages is the working default: enough for a service menu (most sites put
// it on the homepage and a services page) while stretching a Firecrawl balance
// roughly twice as far. Raise it with --limit for a site worth a deeper read.
const perSite = limitArg >= 0 ? Number(args[limitArg + 1]) : 5;
const onlyArg = args.indexOf("--only");
const onlyIds =
  onlyArg >= 0 ? args.slice(onlyArg + 1).filter((a) => /^\d+$/.test(a)).map(Number) : [];

if (!hasFirecrawlKey()) {
  console.error("FIRECRAWL_API_KEY is not set. See .env.example.");
  process.exit(1);
}

interface Row {
  id: number;
  name: string;
  domain: string;
}

const rows = (
  onlyIds.length
    ? await db()`
        select id, name, domain from prospects
        where id = any(${onlyIds}::bigint[]) and domain is not null order by id`
    : await db()`
        select p.id, p.name, p.domain from prospects p
        where p.domain is not null
          and p.owner_first_name is not null
          and p.status <> 'excluded'
          and not exists (select 1 from suppression s where s.domain = p.domain)
        order by p.id`
) as unknown as Row[];

const onDisk = new Set(await listSites());
const todo = rows.filter((r) => !onDisk.has(r.domain));

console.log(`${rows.length} eligible, ${rows.length - todo.length} already on disk, ${todo.length} to crawl.\n`);

for (const row of todo) {
  const website = `https://${row.domain}`;
  process.stdout.write(`#${row.id} ${row.domain} ... `);

  // One free request before spending credits.
  const status = await checkSite(website);
  if (status !== "ok") {
    console.log(status);
    await recordRemark(row.domain, remarkFor(status, []));
    continue;
  }

  try {
    const pages = await crawlPages(website, { limit: perSite });
    if (!pages.length) {
      console.log("no readable pages");
      await recordRemark(row.domain, remarkFor("empty", []));
      continue;
    }
    // Store under the host the pages actually came from, not the one we typed.
    let storedUnder = row.domain;
    try {
      const landed = new URL(pages[0]!.url).hostname.replace(/^www\./, "");
      if (landed && landed !== row.domain) storedUnder = landed;
    } catch {
      /* keep the input domain */
    }
    await savePages(storedUnder, pages);
    await recordRemark(row.domain, remarkFor(status, pages));
    const chars = pages.reduce((sum, p) => sum + p.text.length, 0);
    console.log(`${pages.length} page(s), ${chars.toLocaleString()} chars${storedUnder !== row.domain ? ` -> ${storedUnder}` : ""}`);
  } catch (error) {
    console.log(`failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
