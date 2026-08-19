/**
 * Send the drafted emails in a CSV, in waves, updating the CSV as it goes.
 *
 *   npx tsx src/cli/send-csv.ts --in <file.csv> --plan        # show what would go, send nothing
 *   MAILMAFIA_LIVE=1 npx tsx src/cli/send-csv.ts --in <file.csv>
 *   MAILMAFIA_LIVE=1 npx tsx src/cli/send-csv.ts --in <file.csv> --wave 50 --gap 30
 *
 * Waves of `--wave` emails with `--gap` minutes between them, jittered pauses
 * inside a wave. Neon is not touched: state lives in the CSV, in two columns
 * this writes — `send_status` (sent / failed / skipped) and `send_id` (the
 * Resend message id). A row that already has a send_id is never sent again, so
 * the run is safe to resume after an interruption.
 *
 * A row is sent only if it has a draft AND an address AND no send_flag. Rows
 * whose address is already in --skip-file are left alone, which is how mail
 * already sent from elsewhere is kept out.
 */
import "../env.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { loadInboxes } from "../send/inbox.js";
import { DryRunTransport, transportFromEnv } from "../send/transport.js";

const args = process.argv.slice(2);
const flag = (n: string, d?: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const inPath = flag("in");
const waveSize = Number(flag("wave", "50"));
const gapMinutes = Number(flag("gap", "30"));
const planOnly = args.includes("--plan");
const skipFile = flag("skip-file");

if (!inPath) {
  console.error("usage: npx tsx src/cli/send-csv.ts --in <file.csv> [--wave 50] [--gap 30] [--plan] [--skip-file <f>]");
  process.exit(1);
}

type Row = Record<string, string>;
const rows = parse(readFileSync(inPath, "utf8"), {
  columns: (h: string[]) => h.map((x) => x.trim()),
  skip_empty_lines: true,
  bom: true,
}) as Row[];
const cols = Object.keys(rows[0] ?? {});
for (const c of ["send_status", "send_id", "sent_at"]) if (!cols.includes(c)) cols.push(c);

const alreadySent = new Set(
  skipFile && existsSync(skipFile)
    ? readFileSync(skipFile, "utf8").split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean)
    : [],
);

// A missing or junk address blocks a send. A missing owner name does not: those
// drafts open with a bare "Hey," and are sent by choice.
const BLOCKING = new Set(["NO EMAIL ADDRESS", "vendor/placeholder inbox"]);

const sendable = (r: Row): boolean =>
  Boolean((r.email_body ?? "").trim()) &&
  Boolean((r.email ?? "").trim()) &&
  !BLOCKING.has((r.send_flag ?? "").trim()) &&
  !(r.send_id ?? "").trim() &&
  !alreadySent.has((r.email ?? "").trim().toLowerCase());

const queue = rows.map((r, i) => ({ r, i })).filter(({ r }) => sendable(r));
const waves = Math.ceil(queue.length / waveSize);

const transport = transportFromEnv();
const inbox = loadInboxes()[0]!;
const live = !(transport instanceof DryRunTransport);

console.log(`${queue.length} to send, ${waves} wave(s) of ${waveSize}, ${gapMinutes} min apart`);
console.log(`From ${inbox.fromName} <${inbox.address}>, Reply-To ${inbox.replyTo ?? "(none)"}`);
console.log(`${live ? "LIVE" : "DRY RUN"}${planOnly ? " (plan only)" : ""}`);
if (alreadySent.size) console.log(`${alreadySent.size} address(es) on the skip list`);

if (planOnly) {
  for (let w = 0; w < waves; w++) {
    const chunk = queue.slice(w * waveSize, (w + 1) * waveSize);
    console.log(`\n  wave ${w + 1}: ${chunk.length} emails`);
    for (const { r } of chunk.slice(0, 3)) console.log(`    ${r.company?.slice(0, 34)} -> ${r.email}`);
    if (chunk.length > 3) console.log(`    ... and ${chunk.length - 3} more`);
  }
  console.log("\n--plan: nothing sent, nothing written.");
  process.exit(0);
}

const save = (): void => writeFileSync(inPath, stringify(rows, { header: true, columns: cols }));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const jitter = (): number => 8_000 + Math.random() * 12_000;

let sent = 0;
let failed = 0;

for (let w = 0; w < waves; w++) {
  const chunk = queue.slice(w * waveSize, (w + 1) * waveSize);
  console.log(`\n=== wave ${w + 1}/${waves} — ${chunk.length} emails ===`);

  for (const { r } of chunk) {
    try {
      const res = await transport.send(inbox, {
        to: r.email!,
        subject: r.email_subject!,
        body: r.email_body!,
        idempotencyKey: `csv/${r.place_id || r.email}`,
      });
      r.send_status = res.dryRun ? "dry-run" : "sent";
      r.send_id = res.messageId;
      r.sent_at = new Date().toISOString();
      sent++;
      console.log(`  ${String(sent).padStart(3)} ${r.email!.padEnd(38)} ${res.messageId}`);
    } catch (error) {
      const m = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ");
      r.send_status = "failed";
      r.sent_at = new Date().toISOString();
      failed++;
      console.log(`      FAILED ${r.email} ${m.slice(0, 90)}`);
    }
    save(); // after every send, so an interruption never loses the record
    if (live) await sleep(jitter());
  }

  if (w < waves - 1) {
    console.log(`\n  wave ${w + 1} done (${sent} sent, ${failed} failed). Waiting ${gapMinutes} min.`);
    if (live) await sleep(gapMinutes * 60_000);
  }
}

save();
console.log(`\ndone. ${sent} sent, ${failed} failed. CSV updated: ${inPath}`);
