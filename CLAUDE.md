# mail-mafia — working notes

An agentic email system for cold outreach: harvest leads, draft, send, classify replies, route. Being ported from two n8n workflows to a TypeScript service, one agent at a time.

## Commands

```bash
npm test                  # 11 tests, no API key needed
npm run typecheck
npx tsx src/cli/classify-one.ts "their reply text"        # classify one reply
npx tsx src/cli/send-test.ts you@example.com              # dry run — prints, sends nothing
MAILMAFIA_LIVE=1 npx tsx src/cli/send-test.ts you@...     # actually sends
npx tsx src/cli/write-emails.ts --only 3                  # DRAFT: re-probes + re-composes (slow, overwrites)
npx tsx src/cli/reflow-drafts.ts --dry                    # FORMAT: reflow stored bodies, no re-drafting
```

Sending uses Resend when `RESEND_API_KEY` + `MAIL_FROM` are set (From `hello@mail.armstrongco.ai`), else the Gmail SMTP rig. **To fix formatting, use `reflow-drafts`, never `write-emails`** — the latter regenerates from scratch and can change content or drop a prospect below the two-miss floor.

## Architecture

Two lanes, from the original n8n workflows:

- **Outbound** (`armstrong_outbound.json`) — query matrix → Serper `/places` → qualify → scrape → Claude drafts `subject` + `body` → send → log. **Harvest/enrich, drafting and sending are ported to TypeScript** (probe-based drafting in `src/outreach`, Resend sending in `src/send`); prospect state lives in Neon. The original n8n flow is kept as a reference.
- **Inbox** (`armstrong_inbox.json`) — poll replies → classify → route. **Decision core ported; I/O still n8n.** This lane stays in n8n permanently by design — it's event-driven and integration-heavy, which is what n8n is good at.

Ported so far:

```
src/parse-reply.ts      Gmail message -> sender + their words, quoted thread stripped
src/classify.ts         Claude call, Zod structured output, confidence floor
src/routing.ts          intent -> action
src/outreach/compose.ts probe evidence -> subject + body, in skeleton.md's shape
src/outreach/skeleton.md the email shape, slot by slot (the compose prompt reads it)
src/outreach/reflow.ts  reformat a stored body to the proportional-font-safe shape
src/send/inbox.ts       mailbox config; Resend (MAIL_FROM) or the SMTP rig
src/send/transport.ts   Transport interface; DryRun + SMTP + Resend implementations
src/send/pool.ts        daily caps, LRU rotation, jittered delay
```

## Rules that don't bend

1. **Cold outbound and product email never share a sending domain.** Cold mail eventually collects complaints; keep that away from the domain customers get invoices on.
2. **The confidence floor is enforced in code, not the prompt** (`applyConfidenceFloor`). Below 0.8 the intent becomes UNCLEAR and a human looks at it. The failure mode is silent — a misread "already have an agency, but call me in March" filed as NOT_INTERESTED kills the best lead and nobody sees it.
3. **Only INTERESTED and SEND_REPORT auto-reply.** Everything else goes to a human or exits.
4. **Strip the quoted thread before classifying.** Our own outbound copy is full of enthusiastic buying language and reliably inflates intent.
5. **Sending is off unless `MAILMAFIA_LIVE=1`.** Every other path is a dry run.

## Conventions

- Plain TypeScript + `@anthropic-ai/sdk`. No agent framework — decided after evaluating Mastra, the Vercel AI SDK, the Claude Agent SDK, and Managed Agents.
- Structured outputs via `messages.parse()` + `zodOutputFormat`, never hand-parsed JSON.
- Plain-text email only. HTML templates land in Promotions and read as broadcast; Markdown isn't rendered by mail clients at all. Write for a proportional font: no hard-wrapped prose, and the result block is `Service: rivals. Not you.` entries (capitalized, colon, no arrows, blank line between) — never space-aligned columns, which shatter outside a monospace preview. `reflow-drafts.ts` migrates old bodies into this shape without re-drafting.
- New I/O goes behind an interface (see `Transport`, `QuotaStore`) so the n8n → service swap stays a config change.

## Known gaps — required before any batch send

- **No suppression check.** Nothing stops a send to a domain that already said stop.
- **Quota is in-memory.** Resets every run; can't hold a daily cap across a schedule.
- **DMARC is missing.** For Resend, `mail.armstrongco.ai` has DKIM + the return-path MX + SPF, but no `_dmarc.mail.armstrongco.ai` (Resend verifies without it; add `v=DMARC1; p=none`). The root `_dmarc.armstrongco.ai` is also still missing.
