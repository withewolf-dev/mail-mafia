---
name: mail-mafia-scraping
description: "How mail-mafia gets per-prospect context for email personalisation, and why a Firecrawl agent is the next thing to build"
metadata:
  node_type: memory
  type: state
  originSessionId: fc442e59-c164-4697-99c4-8b1ef8fd0032
  modified: 2026-08-15T20:20:47.914Z
---

The opener in every cold email is written from **scraped website text** — that is the only source of personalisation ([[mail-mafia-project]]). Draft quality is capped by scrape quality, so this is the highest-leverage part of the outbound lane.

**Built as of 2026-08-15**, in `src/enrich/`:
- `scrape.ts` — single page, strip HTML, 6k chars. The original n8n port.
- `crawl.ts` — follows up to 3 same-site links (`/about`, `/services`, `/team`), 12k chars. Measured on six real prospects: four improved, one from 1,152 → 9,299 chars.
- `render.ts` — Firecrawl (`FIRECRAWL_API_KEY` is set) plus a keyless Jina reader.
- `site-text.ts` — `getSiteText()` escalates crawl → Firecrawl → Jina only when text falls under `THIN_TEXT_CHARS`, so the paid path skips the ~70% of sites that don't need it. Wired into both drafters.

**NEXT: write a proper Firecrawl agent.** The naive fallback isn't enough — see below.

**A first implementation was built and reverted on 2026-08-16** at the user's request, so the tree is back to the state above. Findings from it that are worth not re-deriving:
- Firecrawl `/map` + `search` is the right discovery tool. On nuwaworld.com it surfaced `/about-us` — a page the homepage never links to, which the regex crawler therefore cannot reach — and the resulting opener named a real differentiator instead of a generic one. **Page discovery, not JS rendering, was the bigger win.**
- Firecrawl's JSON output format costs +4 credits/page; a plain `messages.parse()` call over the returned markdown does the same extraction for less, and keeps the prompt in the repo.
- `/map` returns exactly **one** URL for bornagaindoctor.com — confirming the site is genuinely a nav menu, not a crawler failure.

**The measurement that motivates it** (bornagaindoctor.com, a JS-heavy Ocala med spa):
```
crawl                    1,526 chars
Firecrawl raw markdown   4,436 chars
Firecrawl after cleanup  1,313 chars   <- link syntax was most of the "gain"
Jina after cleanup       1,395 chars
```

**Raw markdown length is not usable content.** The extra was navigation and link markup; once link syntax is stripped, the rendered result is no better than the plain crawl. So escalating on a character-count threshold does not work — that site genuinely has little prose, and no fetching strategy fixes it.

**What the agent must do differently:** decide *which pages are worth reading* and *whether what came back is usable prose*, instead of trusting a length threshold.

**How to apply:** don't re-run the length-threshold experiment — it's been done. And keep the deeper point in view: for a business whose entire site is a nav menu, the answer isn't better scraping, it's running the actual AI-visibility check, which needs no website at all.
