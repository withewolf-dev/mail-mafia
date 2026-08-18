/**
 * Send one email through the real pipeline — the safe first step of the test
 * order in n8n_replication_guide.md.
 *
 *   npx tsx src/cli/send-test.ts you@yourdomain.com          # dry run, prints only
 *   MAILMAFIA_LIVE=1 npx tsx src/cli/send-test.ts you@...    # actually sends
 *
 * Send to yourself first. Then two friendly addresses. Only then anyone else.
 */
import "../env.js";
import { loadInboxes } from "../send/inbox.js";
import { InboxPool, InMemoryQuotaStore } from "../send/pool.js";
import { DryRunTransport, SmtpTransport, transportFromEnv } from "../send/transport.js";

const to = process.argv[2];
if (!to) {
  console.error("usage: npx tsx src/cli/send-test.ts <recipient@example.com>");
  process.exit(1);
}

const inboxes = loadInboxes();
const pool = new InboxPool(inboxes, new InMemoryQuotaStore());
const transport = transportFromEnv();
const live = !(transport instanceof DryRunTransport);
const kind = transport.constructor.name.replace("Transport", "");

console.log(
  `${inboxes.length} inbox(es), ${pool.dailyCapacity} sends/day capacity — ` +
    `${live ? `LIVE via ${kind}` : "DRY RUN"}\n`,
);

const inbox = await pool.next();

if (transport instanceof SmtpTransport) {
  // Fail on bad credentials before composing anything.
  await transport.verify(inbox);
  console.log(`SMTP connection to ${inbox.smtp!.host} verified.\n`);
}

const result = await transport.send(inbox, {
  to,
  // Timestamped so repeat tests are distinguishable in a crowded inbox.
  subject: `test from mail-mafia — ${new Date().toISOString().slice(11, 19)} UTC`,
  body: [
    "This is a plumbing test from the mail-mafia sending layer.",
    "",
    "If you got this, SMTP auth, the From header, and the inbox pool all work.",
    "",
    inbox.fromName,
    "Armstrong - armstrongco.ai",
  ].join("\n"),
});

console.log(result.dryRun ? "\nDry run complete — nothing sent." : `\nSent. messageId=${result.messageId}`);

if (transport instanceof SmtpTransport) transport.close();
