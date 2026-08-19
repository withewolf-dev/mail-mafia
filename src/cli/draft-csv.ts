/**
 * Draft cold emails for rows of an enriched CSV, standalone — Neon is never
 * touched. Writes a copy of the CSV with three new columns: `email_subject`,
 * `email_body`, and `email_note` (why a row has no email).
 *
 *   npx tsx src/cli/draft-csv.ts --in csv/usa-companies-enriched-v2.csv --take 5
 *   npx tsx src/cli/draft-csv.ts --in <file> --take 30 --concurrency 4
 *
 * `--take N` counts ELIGIBLE rows — ones with an owner first name and a website.
 * Rows without them are copied through with a note and never cost a credit or a
 * probe, so a small `--take` is a real sample rather than a handful of skips.
 *
 * Rows are processed `--concurrency` at a time. Within a row the four probes
 * stay sequential: four concurrent rows already means four concurrent
 * web-searching calls, which is the level the crawler comments warn about.
 */
import "../env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { domainOf } from "../harvest/qualify.js";
import { composeEmail } from "../outreach/compose.js";
import { crawlPages, hasFirecrawlKey } from "../outreach/crawl.js";
import { findMarketStats } from "../outreach/market.js";
import { pickProcedures, readServiceMenu } from "../outreach/procedures.js";
import { probeCategory, probeProcedure, type ProbeResult } from "../outreach/probe.js";
import { listSites, savePages } from "../outreach/store.js";

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const inPath = flag("in");
const take = Number(flag("take", "5"));
const concurrency = Number(flag("concurrency", "4"));
const dry = args.includes("--dry");

if (!inPath) {
  console.error("usage: npx tsx src/cli/draft-csv.ts --in <file.csv> [--take 5] [--concurrency 4] [--dry]");
  process.exit(1);
}
const outPath = inPath.replace(/\.csv$/i, "") + "-drafted.csv";

type Row = Record<string, string>;
const rows = parse(readFileSync(inPath, "utf8"), {
  columns: (h: string[]) => h.map((x) => x.trim()),
  skip_empty_lines: true,
  bom: true,
}) as Row[];

const eligible = (r: Row): boolean =>
  Boolean((r.first_name ?? "").trim()) && Boolean((r.website ?? "").trim());

// Index the first `take` eligible rows, so a small sample is a real sample.
const chosen: number[] = [];
for (let i = 0; i < rows.length && chosen.length < take; i++) {
  if (eligible(rows[i]!)) chosen.push(i);
}
console.log(
  `${rows.length} rows in ${inPath}; drafting ${chosen.length} eligible row(s), ${concurrency} at a time.\n`,
);

/** "New York, NY" -> { city: "New York", region: "NY" } */
function splitCity(value: string): { city: string; region: string } {
  const [city = "", region = ""] = value.split(",").map((p) => p.trim());
  return { city, region };
}

const crawled = new Set(await listSites());

interface Draft {
  subject: string;
  body: string;
  note: string;
}

async function draftRow(row: Row, rowNumber: number): Promise<Draft> {
  const label = `[row ${String(rowNumber).padStart(3)}] ${(row.company ?? "").slice(0, 32)}`;
  const first = (row.first_name ?? "").trim();
  const website = (row.website ?? "").trim();
  const domain = domainOf(website);
  if (!domain) return { subject: "", body: "", note: `skipped: unusable website ${website}` };

  // Crawl only when nothing is on disk — pages already fetched are credits
  // already spent, and two CSV rows can share one domain.
  if (!crawled.has(domain)) {
    if (!hasFirecrawlKey()) return { subject: "", body: "", note: "skipped: no FIRECRAWL_API_KEY" };
    const pages = await crawlPages(website, { limit: 5 });
    if (!pages.length) return { subject: "", body: "", note: "skipped: crawl returned nothing" };
    await savePages(domain, pages);
    crawled.add(domain);
    console.log(`${label}  crawled ${pages.length} page(s)`);
  }

  const menu = await readServiceMenu(domain);
  const procedures = pickProcedures(menu, 3);
  if (procedures.length < 2) {
    return { subject: "", body: "", note: `skipped: only ${procedures.length} procedure(s) on the site` };
  }

  const { city, region } = splitCity(row.city ?? "");
  const target = { businessName: row.company ?? "", domain, city, region };

  const procedureProbes: ProbeResult[] = [];
  for (const procedure of procedures) {
    procedureProbes.push(await probeProcedure(target, procedure));
  }
  const category = await probeCategory(target, menu.category);

  const misses = procedureProbes.filter((p) => !p.namedUs && p.competitors.length);
  if (misses.length < 2) {
    console.log(`${label}  no story (${misses.length} miss)`);
    return { subject: "", body: "", note: `no story: only ${misses.length} miss(es)` };
  }

  const rating = Number(row.rating);
  const reviews = Number(row.reviews);
  const market = await findMarketStats(misses.map((m) => m.label));
  const email = await composeEmail({
    businessName: row.company ?? "",
    city,
    region,
    greeting: first,
    rating: Number.isFinite(rating) && rating > 0 ? rating : null,
    reviewCount: Number.isFinite(reviews) && reviews > 0 ? reviews : null,
    misses,
    category,
    market,
    probeCount: procedureProbes.length + 1,
  });

  console.log(`${label}  DRAFTED  ${email.subject.slice(0, 56)}`);
  return { subject: email.subject, body: email.body, note: "drafted" };
}

/** Run `worker` over the items, `limit` at a time, preserving order. */
async function pooled<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i]!);
      }
    }),
  );
  return results;
}

const started = Date.now();
const drafts = await pooled(chosen, concurrency, async (rowIndex) => {
  const row = rows[rowIndex]!;
  try {
    return await draftRow(row, rowIndex + 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[row ${String(rowIndex + 1).padStart(3)}] ${(row.company ?? "").slice(0, 32)}  FAILED  ${message.slice(0, 60)}`);
    return { subject: "", body: "", note: `failed: ${message}`.slice(0, 300) };
  }
});

const byRow = new Map<number, Draft>();
chosen.forEach((rowIndex, i) => byRow.set(rowIndex, drafts[i]!));

const out = rows.map((row, i) => {
  const d = byRow.get(i);
  return {
    ...row,
    email_subject: d?.subject ?? "",
    email_body: d?.body ?? "",
    email_note: d ? d.note : eligible(row) ? "" : "not attempted: no owner first name or website",
  };
});

const drafted = drafts.filter((d) => d.note === "drafted").length;
const minutes = (Date.now() - started) / 60_000;
console.log(`\n${drafted}/${chosen.length} drafted in ${minutes.toFixed(1)} min` +
  ` (${(minutes / Math.max(chosen.length, 1)).toFixed(1)} min/row at concurrency ${concurrency})`);
const tally = drafts.reduce<Record<string, number>>((acc, d) => {
  const key = d.note.split(":")[0]!;
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});
for (const [note, n] of Object.entries(tally)) console.log(`  ${note}: ${n}`);

if (dry) {
  console.log("\n--dry: nothing written.");
} else {
  writeFileSync(outPath, stringify(out, { header: true }));
  console.log(`\nwrote ${outPath}`);
}
