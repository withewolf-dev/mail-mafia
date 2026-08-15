import "../env.js";

/**
 * One sending mailbox. Today there is exactly one; the pool exists so adding
 * the other eleven is a config change rather than a rewrite.
 */
export interface Inbox {
  /** Stable key for quota accounting. Use the authenticating address. */
  id: string;
  /**
   * What recipients see in the From header. May be a send-as alias rather than
   * the mailbox you authenticate with — e.g. auth as gitartha@station91.in and
   * send as gitartha@armstrongco.ai. The alias must be verified in Gmail under
   * Settings → Accounts → "Send mail as", or Gmail rewrites it to the primary.
   */
  address: string;
  /** Display name on the From header. Must match how the body signs off. */
  fromName: string;
  /** Credentials for the real mailbox. `user` is the auth identity, not the From. */
  smtp: { host: string; port: number; user: string; pass: string };
  /** Hard cap on sends per UTC day for this mailbox. */
  dailyCap: number;
}

/**
 * Read the inbox pool from the environment.
 *
 * Single-inbox form (what we're on now):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_NAME, SMTP_DAILY_CAP
 *
 * When the pool grows, set INBOXES to a JSON array of the same shape and this
 * is the only function that changes.
 */
export function loadInboxes(): Inbox[] {
  const json = process.env.INBOXES;
  if (json) return JSON.parse(json) as Inbox[];

  const user = process.env.SMTP_USER;
  if (!user) {
    throw new Error("No sending inbox configured. Set SMTP_USER in .env (see .env.example).");
  }

  // The password is only needed to actually send. Dry runs work without it, so
  // you can preview exactly what would go out before creating an App Password.
  const pass = process.env.SMTP_PASS ?? "";
  if (!pass && process.env.MAILMAFIA_LIVE === "1") {
    throw new Error(
      "MAILMAFIA_LIVE=1 but SMTP_PASS is empty. Gmail needs an App Password " +
        "(Google Account → Security → 2-Step Verification → App passwords).",
    );
  }

  return [
    {
      id: user,
      // Defaults to the auth address; set SMTP_FROM to send as a verified alias.
      address: process.env.SMTP_FROM ?? user,
      fromName: process.env.SMTP_FROM_NAME ?? "Danish",
      smtp: {
        host: process.env.SMTP_HOST ?? "smtp.gmail.com",
        port: Number(process.env.SMTP_PORT ?? 587),
        user,
        pass,
      },
      // Deliberately low. A brand-new mailbox sending 40 cold emails on day
      // one is how domains get flagged. Raise it only after warmup.
      dailyCap: Number(process.env.SMTP_DAILY_CAP ?? 20),
    },
  ];
}
