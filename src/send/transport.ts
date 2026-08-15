import nodemailer, { type Transporter } from "nodemailer";
import type { Inbox } from "./inbox.js";

export interface OutgoingEmail {
  to: string;
  subject: string;
  /** Plain text only. HTML templates land in Promotions and read as broadcast. */
  body: string;
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

/** Real sending requires an explicit opt-in. Absence of the flag means dry run. */
export function transportFromEnv(): Transport {
  return process.env.MAILMAFIA_LIVE === "1" ? new SmtpTransport() : new DryRunTransport();
}
