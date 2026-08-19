---
name: email-body-format
description: "The plain-text formatting rules for outbound email bodies (colon result block, no arrows, no hard wraps) and how they're enforced"
metadata: 
  node_type: memory
  type: convention
  originSessionId: e8c7f055-1255-4ac6-865a-49978db3f039
  modified: 2026-08-18T10:30:34.299Z
---

Outbound email bodies are **plain text designed for a proportional font** (Gmail etc.), decided 2026-08-18 after arrow-aligned columns broke on mobile.

Rules:
- **No hard wraps.** Each prose paragraph is a single logical line; the client wraps to the reader's screen. Baked-in `\n` at ~65 chars produced ragged mid-sentence wraps on phones.
- **Result block = colon lead-in, not arrows.** Format each entry `Service: rival, rival. Not you.` — service name capitalized, a colon, no `->`, no space padding. A **blank line between each entry** so they stay distinct when a line wraps. (The old `service  ->  rivals` padded-column format shattered because proportional spaces aren't equal width.)
- Short standalone lines (the two market-stat lines, the two-line CTA, the signature) stay on their own lines by design.
- Still plain text only — NOT HTML, NOT Markdown. HTML hurts cold-email deliverability (Promotions/spam), breaks the hand-typed feel, and Markdown isn't rendered by mail clients at all. See [[cold-email-hard-rules]] rule (plain text) and [[no-em-dashes-outreach]].

Enforced in three places, all updated together:
- `src/outreach/compose.ts` — the composer prompt + the `lines` builder (capitalized `Service:` entries, joined with blank lines).
- `src/outreach/skeleton.md` — template block, slot 6, worked example, and the trailing explanation.
- `src/outreach/reflow.ts` (`reflowBody`) + `src/cli/reflow-drafts.ts` — migrate already-stored bodies into this shape. Idempotent; re-running reports 0 changes.

The "Mail Mafia Drafts" artifact preview now renders the body in a proportional font (was monospace, which is what hid the problem). See [[reflow-not-write-emails]].
