---
name: email-recovery-fallbacks
description: "When a prospect has no usable email, ways to recover one before giving up"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e8c7f055-1255-4ac6-865a-49978db3f039
  modified: 2026-08-18T08:44:43.317Z
---

When the owner-finder / scraper fails to produce a usable email for a prospect, don't just leave it blank — try these recovery paths before writing it off:

1. **Look for a published practice/business inbox.** Facebook pages, contact pages, and the owner-finder's own `owner_notes` often already contain a real address (e.g. Aqua Med Spa #3 had `aquamedspa@ocalaplasticsurgery.com` sitting in the notes). A verified business inbox beats a guessed personal one for a cold pitch to the practice.
2. **Infer the naming pattern from a known-live mailbox.** If any one address on the domain is confirmed (e.g. `clrobinson@ocalaplasticsurgery.com` → first-initial+lastname), predict the target (`jrogers@...`). Treat as a guess, not confirmed.
3. **State registry recovery.** For licensed professionals, the state board listing (e.g. FL DOH licence lookup) can carry an email. The pipeline may have nulled it under the "registry or nothing" rule if it could only reach it by hand-passing the city — re-fetch it manually.
4. **Email-verification API** (Hunter / NeverBounce / ZeroBounce) for a pattern-guessed address. These are M365-aware.

**Why:** Raw SMTP RCPT probing is useless on Microsoft 365 domains (`*.mail.protection.outlook.com`) — the gateway accepts every recipient and bounces later, so it returns false "valid" for any address. Check the MX first; if it's Outlook-hosted, skip SMTP verification.

**How to apply:** Prefer a verified business inbox over a guessed personal address for cold outreach. See [[mail-mafia-scraping]] and [[cold-email-hard-rules]]. The `email_verified` column marks whether the address on a prospect row is trusted.
