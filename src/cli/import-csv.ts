/**
 * Load CSVs into Neon. Idempotent — re-running the same file updates rather
 * than duplicating.
 *
 *   npx tsx src/cli/import-csv.ts us-emails.csv
 *   npx tsx src/cli/import-csv.ts ~/Downloads/Find-local-businesses*.csv
 *   npx tsx src/cli/import-csv.ts --dry-run us-emails.csv
 *
 * Business rows (Google Maps exports) upsert on place_id, falling back to
 * domain. Email-only rows attach to an existing business by normalised name,
 * and are inserted standalone when nothing matches.
 */
import "../env.js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { db } from "../db/client.js";
import { detectShape, parseCsv, toRows, type ProspectRow } from "../db/csv-rows.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const files = args.filter((a) => !a.startsWith("--"));

if (files.length === 0) {
  console.error("usage: npx tsx src/cli/import-csv.ts [--dry-run] <file.csv> [more.csv ...]");
  process.exit(1);
}

const totals = { files: 0, read: 0, businesses: 0, emailsAttached: 0, emailsOrphan: 0, skipped: 0 };

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const records = parseCsv(content);
  const shape = detectShape(Object.keys(records[0] ?? {}));
  const rows = toRows(records, basename(file));

  console.log(`${basename(file)}  shape=${shape}  rows=${rows.length}`);
  totals.files++;
  totals.read += rows.length;

  if (shape === "unknown") {
    console.warn("  ! unrecognised headers — skipped");
    totals.skipped += rows.length;
    continue;
  }

  for (const row of rows) {
    if (dryRun) {
      row.email && !row.website ? totals.emailsOrphan++ : totals.businesses++;
      continue;
    }
    const outcome = await upsert(row);
    totals[outcome]++;
  }
}

console.log(
  `\n${totals.files} file(s), ${totals.read} rows read\n` +
    `  businesses upserted : ${totals.businesses}\n` +
    `  emails attached     : ${totals.emailsAttached}\n` +
    `  emails unmatched    : ${totals.emailsOrphan}\n` +
    `  skipped             : ${totals.skipped}` +
    (dryRun ? "\n\n(dry run — nothing written)" : ""),
);

type Outcome = "businesses" | "emailsAttached" | "emailsOrphan" | "skipped";

async function upsert(row: ProspectRow): Promise<Outcome> {
  const q = db();

  // Email-only row: attach to an existing business rather than creating a
  // duplicate of one the Maps export already gave us.
  if (row.email && !row.website && !row.placeId) {
    const matched = (await q`
      update prospects
         set email = coalesce(prospects.email, ${row.email}),
             email_verified = coalesce(${row.emailVerified}, prospects.email_verified),
             source_file = coalesce(prospects.source_file, ${row.sourceFile}),
             updated_at = now()
       where name_key = ${row.nameKey}
         and email is null
      returning id`) as { id: number }[];
    if (matched.length > 0) return "emailsAttached";
  }

  await q`
    insert into prospects (
      place_id, name, name_key, website, domain, email, email_verified,
      phone, address, city, region, rating, review_count, source_file
    ) values (
      ${row.placeId}, ${row.name}, ${row.nameKey}, ${row.website}, ${row.domain},
      ${row.email}, ${row.emailVerified}, ${row.phone}, ${row.address},
      ${row.city}, ${row.region}, ${row.rating}, ${row.reviewCount}, ${row.sourceFile}
    )
    on conflict (place_id) do update set
      name         = excluded.name,
      website      = coalesce(excluded.website, prospects.website),
      domain       = coalesce(excluded.domain, prospects.domain),
      email        = coalesce(prospects.email, excluded.email),
      phone        = coalesce(excluded.phone, prospects.phone),
      address      = coalesce(excluded.address, prospects.address),
      city         = coalesce(excluded.city, prospects.city),
      region       = coalesce(excluded.region, prospects.region),
      rating       = coalesce(excluded.rating, prospects.rating),
      review_count = coalesce(excluded.review_count, prospects.review_count),
      updated_at   = now()`;

  return row.email && !row.website ? "emailsOrphan" : "businesses";
}
