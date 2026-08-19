---
name: armstrong-outbound-engine
description: "The Armstrong cold-outbound pitch, ICP, and the two n8n workflows that implement it — the concrete first use case for mail-mafia"
metadata: 
  node_type: memory
  type: project
  originSessionId: fc442e59-c164-4697-99c4-8b1ef8fd0032
  modified: 2026-08-15T12:42:03.649Z
---

The working use case inside [[mail-mafia-project]]. **Armstrong** (`armstrongco.ai`, sender "Danish") sells **AI-search visibility** — getting a business cited in AI search answers like "best med spa in Dubai". The cold pitch is a diagnostic, not a compliment: run the prospect's visibility check first, then offer a free 12-query breakdown showing where they're invisible.

**ICP (query matrix in `Build Query Matrix`):** local high-ticket services — company formation / PRO services, med spas, aesthetic clinics, cosmetic dentists, plastic surgeons, immigration & estate attorneys, CPA firms — in UAE (Dubai/Business Bay/DIFC/JLT/Al Barsha, Abu Dhabi, Sharjah) and US (Scottsdale, Austin, Dallas, Miami, Atlanta, Nashville, Denver, Newport Beach).

**Qualifier:** Serper `/places` (Google Maps), keep only website + rating ≥ 4.0 + ≥15 reviews, drop national chains. Review count is the revenue proxy.

**Two workflows, deliberately split** (different triggers, frequencies, failure modes):
- `armstrong_outbound.json` — daily 9am: query matrix → Serper Places → qualify → Airtable upsert → scrape site → Claude drafts `subject` + `opener` only (template writes the rest) → Gmail send → log, with a 90s throttle.
- `armstrong_inbox.json` — every 30 min: unread Gmail → strip quoted thread → Claude classify intent → Switch route → auto-reply only on INTERESTED/SEND_REPORT → Slack ping for humans → Airtable state.

**Stack:** Serper, Anthropic (`claude-sonnet-5`), Gmail OAuth2, Airtable (`Prospects` keyed on `place_id` as primary + `Suppression` keyed on domain), Slack. Airtable is state; Slack is notification.

**How to apply:** Claude gets two variable slots (subject, opener) — never let it write the whole email or invent claims about a clinic. See [[cold-email-hard-rules]] for the constraints that survive any rewrite.
