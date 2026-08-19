---
name: reflow-not-write-emails
description: "To fix email FORMATTING use reflow-drafts, never write-emails — the latter re-researches from scratch, overwrites content, and can skip a prospect"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e8c7f055-1255-4ac6-865a-49978db3f039
  modified: 2026-08-19T17:02:09.971Z
---

**To fix formatting of existing drafts, run `src/cli/reflow-drafts.ts`, NOT `src/cli/write-emails.ts`.**

**Why:** `write-emails.ts` does not reformat — it *regenerates from zero*: re-runs ~4 web-searching probe calls per prospect (slow, minutes for a few prospects), re-picks competitors, and overwrites `subject`/`body`. Learned 2026-08-18 the hard way: a "re-draft to fix alignment" on prospects 1 and 3 replaced their content with freshly-probed different competitors/subjects, and prospect 4 produced *no email at all* ("only 1 miss — no story") because that run's probes named them for more procedures, dropping it below the two-miss floor. Originals had to be restored from the artifact copy.

**How to apply:**
- Formatting-only change → `reflow-drafts.ts` (`reflowBody`): instant, content-preserving (never changes a claim), idempotent.
- Only run `write-emails.ts` when you actually want fresh research / a new draft. It stores to the DB, so it is destructive to the current draft.
- Originals are recoverable from the "Mail Mafia Drafts" artifact and from already-sent copies if a re-draft clobbers something.

See [[email-body-format]].

**Related fix, 2026-08-19:** `write-emails.ts` used to strip every competitor that was also a row in `prospects` (all 518, not just contacted ones), then treat the emptied list as "no story" - silently killing genuinely invisible prospects like Dental365, which was absent from all four AI answers. Gitartha had the rule removed entirely, so competitor names now go into the email exactly as the probe reported them. Two other bugs fixed the same day: an unpaired UTF-16 surrogate from a sliced page crashing the API with a 400 (now stripped in `procedures.ts`), and `crawl-batch` treating an *empty* directory as "already crawled" so a prospect could never be crawled.
