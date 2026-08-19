/**
 * Write cold emails in the probe format, one per prospect.
 *
 *   npx tsx src/cli/write-emails.ts --only 1        # one prospect, printed and stored
 *   npx tsx src/cli/write-emails.ts --dry --only 1  # printed, stored nothing
 *   npx tsx src/cli/write-emails.ts --limit 5       # next five that need one
 *
 * The chain per prospect: read their crawled site for what they actually do ->
 * probe an AI with web search for three of those procedures plus the broad
 * category -> look up market figures for the ones they are missing from ->
 * compose. Subject lands in prospects.subject, body in prospects.body.
 *
 * Costs roughly four web-searched model calls per prospect, so it is not free
 * and it is not fast. That is the price of an email whose every claim is
 * checkable.
 */
import "../env.js";
import { db } from "../db/client.js";
import { composeEmail, greetingFor } from "../outreach/compose.js";
import { findMarketStats } from "../outreach/market.js";
import { pickProcedures, readServiceMenu } from "../outreach/procedures.js";
import { probeCategory, probeProcedure, type ProbeResult } from "../outreach/probe.js";
import { listSites } from "../outreach/store.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 5;
const onlyArg = args.indexOf("--only");
const onlyIds =
  onlyArg >= 0 ? args.slice(onlyArg + 1).filter((a) => /^\d+$/.test(a)).map(Number) : [];

interface Row {
  id: number;
  name: string;
  domain: string;
  city: string;
  region: string;
  rating: string | null;
  review_count: number | null;
  owner_first_name: string;
  owner_last_name: string;
  owner_notes: string | null;
}

const rows = (
  onlyIds.length
    ? await db()`
        select id, name, domain, city, region, rating, review_count,
               owner_first_name, owner_last_name, owner_notes
        from prospects where id = any(${onlyIds}::bigint[]) order by id`
    : await db()`
        select p.id, p.name, p.domain, p.city, p.region, p.rating, p.review_count,
               p.owner_first_name, p.owner_last_name, p.owner_notes
        from prospects p
        where p.owner_first_name is not null and p.domain is not null
          and p.status <> 'excluded'
          and not exists (select 1 from suppression s where s.domain = p.domain)
        order by p.id limit ${limit}`
) as unknown as Row[];

const crawled = new Set(await listSites());

for (const row of rows) {
  console.log(`\n${"=".repeat(70)}\n#${row.id}  ${row.name}  (${row.domain})`);

  if (!crawled.has(row.domain)) {
    console.log("  skipped: nothing crawled. Run crawl-batch first.");
    continue;
  }

  try {
    const menu = await readServiceMenu(row.domain);
    const procedures = pickProcedures(menu, 3);
    if (procedures.length < 2) {
      console.log(`  skipped: only ${procedures.length} procedure(s) found on the site.`);
      continue;
    }
    console.log(`  category: ${menu.category}`);
    console.log(`  probing: ${procedures.join(", ")}`);

    const target = {
      businessName: row.name,
      domain: row.domain,
      city: row.city,
      region: row.region,
    };

    // Sequential on purpose: each probe is a web-searching model call, and
    // firing four at once is how you find a rate limit.
    const procedureProbes: ProbeResult[] = [];
    for (const procedure of procedures) {
      const result = await probeProcedure(target, procedure);
      procedureProbes.push(result);
      console.log(
        `    ${result.namedUs ? "NAMED" : "not named"}  ${result.label}` +
          `  -> ${result.competitors.slice(0, 3).join(", ") || "(none)"}`,
      );
    }
    const category = await probeCategory(target, menu.category);
    console.log(
      `    ${category.namedUs ? "NAMED" : "not named"}  ${category.label} (broad)` +
        `  -> ${category.competitors.slice(0, 3).join(", ") || "(none)"}`,
    );

    const misses = procedureProbes.filter((p) => !p.namedUs && p.competitors.length);
    // The skeleton's own send-nothing rule: fewer than two misses and the
    // result block collapses, which is the entire argument of the email.
    if (misses.length < 2) {
      console.log(`  no email: only ${misses.length} miss(es) — no story to tell.`);
      continue;
    }

    const market = await findMarketStats(misses.map((m) => m.label));
    const email = await composeEmail({
      businessName: row.name,
      city: row.city,
      region: row.region,
      greeting: greetingFor(row.owner_first_name, row.owner_last_name, row.owner_notes),
      rating: row.rating ? Number(row.rating) : null,
      reviewCount: row.review_count,
      misses,
      category,
      market,
      probeCount: procedureProbes.length + 1,
    });

    console.log(`\n  SUBJECT: ${email.subject}\n`);
    console.log(email.body.split("\n").map((l) => `  | ${l}`).join("\n"));
    console.log("\n  evidence:");
    for (const line of email.evidenceUsed) console.log(`    · ${line}`);
    if (email.notSaid.length) {
      console.log("  not said:");
      for (const line of email.notSaid) console.log(`    · ${line}`);
    }

    if (dry) continue;
    await db()`
      update prospects set
        subject     = ${email.subject},
        body        = ${email.body},
        opener      = ${email.body.split("\n\n")[1] ?? null},
        draft_error = null,
        status      = 'drafted',
        drafted_at  = now(),
        updated_at  = now()
      where id = ${row.id}`;
    console.log("\n  stored.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  failed: ${message}`);
    if (!dry) {
      await db()`update prospects set draft_error = ${message}, updated_at = now() where id = ${row.id}`;
    }
  }
}
