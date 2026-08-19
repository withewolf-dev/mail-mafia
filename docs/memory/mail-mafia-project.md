---
name: mail-mafia-project
description: What mail-mafia is and how far the n8n-to-TypeScript port has actually got
metadata: 
  node_type: memory
  type: project
  originSessionId: fc442e59-c164-4697-99c4-8b1ef8fd0032
  modified: 2026-08-15T15:06:24.291Z
---

`mail-mafia` (in `armstrongco-lab/`) is an agentic email system for cold outreach and lead conversion: harvest leads, reach out, classify replies, convert. Started Aug 2026. Repo: `withewolf-dev/mail-mafia` (see [[github-ssh-setup]]).

It began as four reference docs plus two n8n workflows. **As of 2026-08-15 it is a real TypeScript service** — the port off n8n is underway, one agent at a time, following the plan in `n8n_replication_guide.md` ("run it in n8n for a week, then port the half that hurts").

**Built and working end to end:**
- **Reply classifier** — strips the quoted thread, calls Claude with a Zod-schema structured output, enforces the 0.8 confidence floor in code, routes intent to an action. Verified against live replies.
- **Sending layer** — SMTP transport, inbox pool with per-mailbox daily caps and LRU rotation, jittered 60–180s delay. Real mail delivered to an external address.
- **Harvest** — query matrix, Serper `/places` client, deterministic qualifier (needs `SERPER_API_KEY`).
- **Drafter** — scrape → Claude fills subject + opener only → fixed template. House style enforced in code, not just the prompt.
- **Neon Postgres** — 518 prospects imported from CSV; 151 drafted and stored. Replaces the planned Airtable state store.
- Dry run is the default everywhere; real sending needs `MAILMAFIA_LIVE=1`.

**Deliberately not built yet, and both are required before any batch send touches a stranger:**
1. **Suppression check** — nothing currently stops a send to a domain that already said stop.
2. **Persistent quota** — the daily counter is in-memory, so it resets every run and can't hold a cap across a schedule.

**Next up: a Firecrawl agent** that decides which pages to read and whether the text is usable prose — see [[mail-mafia-scraping]] for why the length-threshold fallback wasn't enough. After that: I/O adapters for Gmail, then the pipeline shell (concurrency, resume, rotation), which is the only genuinely hard part and the thing that breaks n8n's ~200/run ceiling ([[cold-email-hard-rules]]).

**How to apply:** the inbox lane stays in n8n permanently by design; only the outbound lane is being ported. Don't re-derive the architecture — see [[mail-mafia-stack-decision]] and [[mail-mafia-sending-identity]].
