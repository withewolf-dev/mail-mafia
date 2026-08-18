import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";
import type { Inbox } from "./inbox.js";

export interface OutgoingEmail {
  to: string;
  subject: string;
  /** Plain text only. HTML templates land in Promotions and read as broadcast. */
  body: string;
  /**
   * Optional idempotency key so a retried send never becomes a duplicate.
   * Same key + same payload returns the original result; same key + different
   * payload is a 409. Use a stable per-prospect id, e.g. `cold/${prospectId}`.
   * Honored by the Resend transport; ignored by SMTP (which has no equivalent).
   */
  idempotencyKey?: string;
}

export interface SendResult {
  messageId: string;
  inboxId: string;
  /** True when nothing left the machine. */
  dryRun: boolean;
}

export interface Transport {
  send(inbox: Inbox, email: OutgoingEmail): Promise<SendResult>;
}

/**
 * Logs what would be sent and sends nothing. This is the default everywhere —
 * real sending is opt-in via MAILMAFIA_LIVE=1, so no half-finished pipeline
 * can put mail in a stranger's inbox by accident.
 */
export class DryRunTransport implements Transport {
  async send(inbox: Inbox, email: OutgoingEmail): Promise<SendResult> {
    console.log(
      [
        "── DRY RUN — nothing sent ──────────────────────────",
        `From:    ${inbox.fromName} <${inbox.address}>`,
        `To:      ${email.to}`,
        `Subject: ${email.subject}`,
        "",
        email.body,
        "────────────────────────────────────────────────────",
      ].join("\n"),
    );
    return { messageId: `dryrun-${Date.now()}`, inboxId: inbox.id, dryRun: true };
  }
}

export class SmtpTransport implements Transport {
  /** One connection pool per inbox, built on first use. */
  private transporters = new Map<string, Transporter>();

  private transporterFor(inbox: Inbox): Transporter {
    if (!inbox.smtp) {
      throw new Error(`Inbox ${inbox.id} has no SMTP credentials; it is configured for Resend.`);
    }
    let t = this.transporters.get(inbox.id);
    if (!t) {
      t = nodemailer.createTransport({
        host: inbox.smtp.host,
        port: inbox.smtp.port,
        secure: inbox.smtp.port === 465,
        auth: { user: inbox.smtp.user, pass: inbox.smtp.pass },
      });
      this.transporters.set(inbox.id, t);
    }
    return t;
  }

  async send(inbox: Inbox, email: OutgoingEmail): Promise<SendResult> {
    const info = await this.transporterFor(inbox).sendMail({
      from: { name: inbox.fromName, address: inbox.address },
      to: email.to,
      subject: email.subject,
      text: email.body,
    });
    return { messageId: info.messageId, inboxId: inbox.id, dryRun: false };
  }

  async verify(inbox: Inbox): Promise<void> {
    await this.transporterFor(inbox).verify();
  }

  close(): void {
    for (const t of this.transporters.values()) t.close();
    this.transporters.clear();
  }
}

/**
 * Sends over the Resend HTTP API. One API key for the account; the sending
 * identity is the inbox's From address, which must be on a Resend-verified
 * domain (mail.armstrongco.ai). No SMTP credentials involved.
 */
export class ResendTransport implements Transport {
  private readonly resend: Resend;

  constructor(apiKey = process.env.RESEND_API_KEY) {
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not set. Get one at https://resend.com/api-keys.");
    }
    this.resend = new Resend(apiKey);
  }

  async send(inbox: Inbox, email: OutgoingEmail): Promise<SendResult> {
    const { data, error } = await this.resend.emails.send(
      {
        from: `${inbox.fromName} <${inbox.address}>`,
        to: [email.to],
        subject: email.subject,
        // Plain text only, same rule as everywhere else in the pipeline.
        text: email.body,
      },
      email.idempotencyKey ? { idempotencyKey: email.idempotencyKey } : undefined,
    );

    if (error) {
      // Surface Resend's own message — name + description — rather than a bare object.
      throw new Error(`Resend rejected the send: ${error.name}: ${error.message}`);
    }
    return { messageId: data!.id, inboxId: inbox.id, dryRun: false };
  }
}

/**
 * Real sending requires an explicit opt-in. Absence of MAILMAFIA_LIVE means dry
 * run. When live, Resend is the sender if RESEND_API_KEY is present; otherwise
 * fall back to the SMTP rig.
 */
export function transportFromEnv(): Transport {
  if (process.env.MAILMAFIA_LIVE !== "1") return new DryRunTransport();
  return process.env.RESEND_API_KEY ? new ResendTransport() : new SmtpTransport();
}
