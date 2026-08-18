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
  /**
   * Where replies should go, if different from the From address. The sending
   * subdomain (mail.armstrongco.ai) has no inbox, so replies are pointed at a
   * mailbox that does — e.g. hello@armstrongco.ai, which receives via Google.
   */
  replyTo?: string;
  /**
   * Credentials for the real mailbox. `user` is the auth identity, not the From.
   * Optional: the Resend transport sends over the API and needs no SMTP creds.
   */
  smtp?: { host: string; port: number; user: string; pass: string };
  /** Hard cap on sends per UTC day for this mailbox. */
  dailyCap: number;
}

/**
 * Read the inbox pool from the environment.
 *
 * Resend form (what we're moving to): set RESEND_API_KEY and the sender is
 * built from
 *   MAIL_FROM (e.g. hello@mail.armstrongco.ai), MAIL_FROM_NAME, MAIL_DAILY_CAP
 * No SMTP credentials are needed — the Resend transport uses the HTTP API.
 *
 * SMTP form (the test-phase rig):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_FROM_NAME, SMTP_DAILY_CAP
 *
 * When the pool grows, set INBOXES to a JSON array of the same shape and this
 * is the only function that changes.
 */
export function loadInboxes(): Inbox[] {
  const json = process.env.INBOXES;
  if (json) return JSON.parse(json) as Inbox[];

  // Resend is the sender once RESEND_API_KEY is set. The From address is the
  // whole identity — it must be on a domain verified in the Resend dashboard.
  if (process.env.RESEND_API_KEY) {
    const address = process.env.MAIL_FROM;
    if (!address) {
      throw new Error(
        "RESEND_API_KEY is set but MAIL_FROM is empty. Set MAIL_FROM to an " +
          "address on a Resend-verified domain, e.g. hello@mail.armstrongco.ai.",
      );
    }
    return [
      {
        id: address,
        address,
        fromName: process.env.MAIL_FROM_NAME ?? "Gitartha",
        // The From subdomain can't receive; send replies somewhere that can.
        replyTo: process.env.MAIL_REPLY_TO,
        // Deliberately low. A brand-new domain sending 40 cold emails on day
        // one is how it gets flagged. Raise it only after warmup.
        dailyCap: Number(process.env.MAIL_DAILY_CAP ?? 20),
      },
    ];
  }

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
