/**
 * Draft curiosity-format cold emails for rows of an enriched CSV.
 *
 *   npx tsx src/cli/curiosity-csv.ts --in csv/usa-companies-enriched-v2.csv --take 1
 *   npx tsx src/cli/curiosity-csv.ts --in <file> --take 30 --concurrency 4
 *   npx tsx src/cli/curiosity-csv.ts --in <file> --only raphaelson    # match by name
 *
 * Reads each business's own site, pulls the credibility facts and the one
 * distinctive client they spend money to win, and writes the email into new
 * `email_subject` / `email_body` columns. No probes and no Firecrawl: about two
 * minutes a row instead of nine, and no credit spent.
 *
 * `--take N` counts ELIGIBLE rows — ones with an owner first name and a website
 * — so a small sample is a real sample rather than a handful of skips.
 */
import "../env.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { composeCuriosity, researchSite } from "../outreach/curiosity.js";

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const inPath = flag("in");
const take = Number(flag("take", "1"));
const concurrency = Number(flag("concurrency", "4"));
const only = (flag("only") ?? "").toLowerCase();
const dry = args.includes("--dry");

if (!inPath) {
  console.error("usage: npx tsx src/cli/curiosity-csv.ts --in <file.csv> [--take N] [--concurrency 4] [--only <name>] [--dry]");
  process.exit(1);
}
const outPath = inPath.replace(/\.csv$/i, "") + "-curiosity.csv";

/** How to name the audience in "I run those searches for ___". */
const AUDIENCE: Record<string, string> = {
  law: "law firms",
  "pi law": "injury firms",
  dental: "dental practices",
  "med spa": "med spas",
  plumbing: "plumbing companies",
};

type Row = Record<string, string>;
const readCsv = (path: string): Row[] =>
  parse(readFileSync(path, "utf8"), {
    columns: (h: string[]) => h.map((x) => x.trim()),
    skip_empty_lines: true,
    bom: true,
  }) as Row[];

// Resume from the output file when it exists, so drafts already written — and
// any a human has approved — survive the next run untouched.
const resuming = existsSync(outPath);
const rows = readCsv(resuming ? outPath : inPath);
if (resuming) console.log(`resuming from ${outPath} (existing drafts are kept)`);

const eligible = (r: Row): boolean =>
  Boolean((r.first_name ?? "").trim()) && Boolean((r.website ?? "").trim());
const alreadyDrafted = (r: Row): boolean => Boolean((r.email_body ?? "").trim());

const chosen: number[] = [];
let kept = 0;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i]!;
  if (!eligible(r)) continue;
  if (alreadyDrafted(r)) { kept++; continue; }
  if (only && !(r.company ?? "").toLowerCase().includes(only)) continue;
  chosen.push(i);
  if (!only && chosen.length >= take) break;
}
console.log(
  `${rows.length} rows; ${kept} already drafted and kept; drafting ${chosen.length}, ${concurrency} at a time.\n`,
);

interface Draft {
  subject: string;
  body: string;
  note: string;
}

async function draftRow(row: Row, rowNumber: number): Promise<Draft> {
  const company = row.company ?? "";
  const label = `[row ${String(rowNumber).padStart(3)}] ${company.slice(0, 32)}`;
  const research = await researchSite(company, (row.website ?? "").trim());
  const vertical = (row.vertical ?? "").trim().toLowerCase();
  const rating = Number(row.rating);
  const reviews = Number(row.reviews);
  const email = await composeCuriosity({
    businessName: company,
    greeting: (row.first_name ?? "").trim(),
    vertical: AUDIENCE[vertical] ?? `${vertical || "local"} businesses`,
    rating: Number.isFinite(rating) && rating > 0 ? rating : null,
    reviewCount: Number.isFinite(reviews) && reviews > 0 ? reviews : null,
    research,
  });
  console.log(`${label}  DRAFTED  ${research.clientScenario.slice(0, 60)}`);
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
    const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ");
    // Print the whole message: a truncated 400 tells you nothing about why.
    console.log(`[row ${String(rowIndex + 1).padStart(3)}] ${(row.company ?? "").slice(0, 32)}  FAILED\n    ${message}`);
    return { subject: "", body: "", note: `failed: ${message}`.slice(0, 300) };
  }
});

const byRow = new Map<number, Draft>();
chosen.forEach((rowIndex, i) => byRow.set(rowIndex, drafts[i]!));

const out = rows.map((row, i) => {
  const d = byRow.get(i);
  if (d) return { ...row, email_subject: d.subject, email_body: d.body, email_note: d.note };
  // Untouched this run: keep whatever is already there rather than blanking it.
  return {
    ...row,
    email_subject: row.email_subject ?? "",
    email_body: row.email_body ?? "",
    email_note:
      row.email_note ??
      (eligible(row) ? "" : "not attempted: no owner first name or website"),
  };
});

const drafted = drafts.filter((d) => d.note === "drafted").length;
const minutes = (Date.now() - started) / 60_000;
console.log(`\n${drafted}/${chosen.length} drafted in ${minutes.toFixed(1)} min.`);

if (dry) {
  for (const [i, rowIndex] of chosen.entries()) {
    const d = drafts[i]!;
    if (!d.body) continue;
    console.log(`\n${"=".repeat(70)}\nTO: ${rows[rowIndex]!.email}\nSUBJECT: ${d.subject}\n\n${d.body}`);
  }
  console.log("\n--dry: nothing written.");
} else {
  writeFileSync(outPath, stringify(out, { header: true }));
  console.log(`\nwrote ${outPath}`);
}
