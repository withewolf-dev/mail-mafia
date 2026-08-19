---
name: mail-mafia-sending-identity
description: "How mail-mafia authenticates and sends mail — armstrongco.ai is a send-as alias on gitartha@station91.in, and Workspace accounts can't create app passwords"
metadata: 
  node_type: memory
  type: gotcha
  originSessionId: fc442e59-c164-4697-99c4-8b1ef8fd0032
  modified: 2026-08-18T11:28:41.789Z
---

Discovered 2026-08-15, after an hour of `535 BadCredentials`. **`gitartha@armstrongco.ai` is not a mailbox — it is a send-as alias on the `gitartha@station91.in` Google account.**

Two consequences that are easy to get wrong:

1. **Authenticate as `gitartha@station91.in`, send as `gitartha@armstrongco.ai`.** These are separate config values (`SMTP_USER` vs `SMTP_FROM`). Authenticating as the alias returns `535`. Verified working: Gmail honors the alias and the message-id comes back `@armstrongco.ai`.
2. **Google Workspace accounts usually cannot create app passwords.** Google's docs list "work, school, or organization account" as a reason the option is missing. The app password that works was minted on the personal `station91.in` account. Don't send anyone to Admin console for "Less secure apps" — Google removed that setting entirely (gone mid-2024, disabled March 2025). App passwords still work as the documented exception; OAuth2 is the fallback if they're unavailable (n8n already uses Gmail OAuth2 for this same mailbox, so OAuth is proven).

**DNS state as of 2026-08-15** — the opposite of what you'd assume:
- `armstrongco.ai`: SPF ✅ (`include:_spf.google.com`), DKIM ✅, **DMARC ❌ missing**
- `station91.in`: SPF ❌, DKIM ❌, DMARC ❌ — the account actually authenticating has no email auth at all

So sending as the `armstrongco.ai` alias is the *correct* path, not a compromise. Adding `v=DMARC1; p=none` at `_dmarc.armstrongco.ai` is the outstanding task.

**How to apply:** this is the test-phase rig, not the production sender. `station91.in` is a real business domain and cold outbound eventually collects complaints — the endgame is still secondary domains with a provider that hands over plain SMTP credentials ([[cold-email-hard-rules]] rule 1). The `Transport` interface already abstracts this, so switching is config.

---

**UPDATE 2026-08-18 — production sender is Resend on the subdomain `mail.armstrongco.ai`.** From address `hello@mail.armstrongco.ai`. This is the "endgame" the note above anticipated. Using a dedicated *sending subdomain* (not the root `armstrongco.ai`) is deliberate: it keeps cold-mail reputation off the root domain where product/customer mail lives, which is the spirit of [[cold-email-hard-rules]] rule 1.

Code (all committed to the `Transport` seam, so the swap was config + one class):
- `ResendTransport` in `src/send/transport.ts` (Resend HTTP API, plain-text only, optional `idempotencyKey` on `OutgoingEmail`).
- `transportFromEnv()`: DryRun unless `MAILMAFIA_LIVE=1`; when live, Resend if `RESEND_API_KEY` is set, else the old SMTP rig.
- `loadInboxes()` builds a Resend inbox from `MAIL_FROM` / `MAIL_FROM_NAME` / `MAIL_DAILY_CAP` when `RESEND_API_KEY` is set; `Inbox.smtp` is now optional.
- Env: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` (optional), `MAIL_FROM`, `MAIL_FROM_NAME`, `MAIL_DAILY_CAP`. `resend` npm dep added.

DNS state for `mail.armstrongco.ai` as of 2026-08-18 (already provisioned, likely verified in Resend):
- DKIM `resend._domainkey.mail.armstrongco.ai` ✅
- Return-path MX `send.mail.armstrongco.ai` → `feedback-smtp.us-east-1.amazonses.com` ✅
- SPF `send.mail.armstrongco.ai` → `v=spf1 include:amazonses.com ~all` ✅
- DMARC `_dmarc.mail.armstrongco.ai` ❌ still missing (Resend verifies without it; add `v=DMARC1; p=none` to close it). Root `_dmarc.armstrongco.ai` also still missing.

To go live: put `RESEND_API_KEY` + `MAIL_FROM=hello@mail.armstrongco.ai` in `.env`, confirm the domain shows Verified in the Resend dashboard, then `MAILMAFIA_LIVE=1`.

**Replies (2026-08-18):** `mail.armstrongco.ai` has NO MX — it's a send-only subdomain, so replies to the From address would bounce. Fix in place: `MAIL_REPLY_TO=gitartha@armstrongco.ai` (`Inbox.replyTo`, applied by both transports) points replies at the root domain, which has Google MX (receives into the station91.in Gmail via the alias). Confirmed working. This is a stopgap — the real path is Resend Inbound (add an MX on `mail.armstrongco.ai` → Resend, `email.received` webhook → classifier), which belongs in the n8n inbox lane. Root `armstrongco.ai` MX = Google; DNS is on Cloudflare.
