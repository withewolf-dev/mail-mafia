/**
 * Find the owner (name + email) for prospects, the way a human googles it:
 * search "<business> owner", then "<business> <owner> email". Results are
 * stored on the prospect row (owner_first_name / owner_last_name / owner_email
 * / owner_notes).
 *
 *   npx tsx src/cli/find-owner.ts                # 5 unenriched prospects from Neon
 *   npx tsx src/cli/find-owner.ts --limit 3
 *   npx tsx src/cli/find-owner.ts --dry          # print only, store nothing
 *
 * Costs up to two search credits + two Claude calls per prospect.
 */
import "../env.js";
import { db } from "../db/client.js";
import { findOwner } from "../outreach/owner.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 5;
// Re-run specific rows regardless of owner_found_at: --redo 3 4
const redoArg = args.indexOf("--redo");
const redoIds =
  redoArg >= 0 ? args.slice(redoArg + 1).filter((a) => /^\d+$/.test(a)).map(Number) : [];

interface Row {
  id: number;
  name: string;
  domain: string;
  city: string | null;
}

// Live sites first — a parked domain has no owner worth two credits — and
// skip rows already enriched so reruns walk forward through the list.
const rows = (
  redoIds.length
    ? await db()`
        select id, name, domain, city from prospects
        where id = any(${redoIds}::bigint[]) and domain is not null
        order by id`
    : await db()`
        select id, name, domain, city
        from prospects
        where domain is not null and owner_found_at is null
        order by (scraping_remarks like 'ok%') desc nulls last, id
        limit ${limit}`
) as unknown as Row[];

if (!rows.length) {
  console.log("Nothing to enrich: every prospect with a domain already has owner_found_at set.");
  process.exit(0);
}

for (const row of rows) {
  console.log(`\n#${row.id}  ${row.name}  (${row.domain})`);
  try {
    const guess = await findOwner(row.domain, row.name, row.city ?? undefined);
    const name = [guess.firstName, guess.lastName].filter(Boolean).join(" ") || "(not found)";
    console.log(
      `  owner: ${name}${guess.role ? ` — ${guess.role}` : ""}  (confidence ${guess.nameConfidence.toFixed(2)})`,
    );
    console.log(
      `  email: ${guess.email ?? "(none in results)"}` +
        (guess.email ? `  (confidence ${guess.emailConfidence.toFixed(2)}, via ${guess.emailSource})` : ""),
    );
    for (const line of guess.evidence) console.log(`    · ${line}`);

    if (dry) continue;

    // owner_found_at marks "we looked", not "we found" — otherwise reruns
    // burn credits re-searching the same ownerless prospects forever.
    const notes = [
      `queries: ${guess.queries.join(" | ")}`,
      `name confidence: ${guess.nameConfidence.toFixed(2)}, email confidence: ${guess.emailConfidence.toFixed(2)}`,
      `result pages opened: ${guess.pagesRead ? "yes" : "no, snippets only"}`,
      `email source: ${guess.emailSource ?? "none"}`,
      ...guess.evidence,
    ].join("\n");
    await db()`
      update prospects set
        owner_first_name = ${guess.firstName},
        owner_last_name  = ${guess.lastName},
        owner_email      = ${guess.email},
        owner_notes      = ${notes},
        owner_found_at   = now(),
        updated_at       = now()
      where id = ${row.id}
    `;
    console.log("  stored.");
  } catch (error) {
    console.log(`  failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
