---
name: db-output-preferences
description: "When showing Neon rows, print every column — not a hand-picked subset"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 0b43e7c3-fef5-4ad7-b4c7-b7d820d7662a
  modified: 2026-08-17T13:41:25.845Z
---

When showing database rows, show the whole table — every column, not a curated
selection. Transpose (columns as rows) when there are too many to fit across.

**Why:** Picking "the interesting columns" hides things the user is trying to
see — `draft_error`, `email_verified`, and the stale `opener` greetings only
became visible once the full row was printed. They also asked twice where
`owner_first_name` had gone, because it was omitted from a narrowed view.

**How to apply:** Default to `select *`. Summarise only genuinely huge text
fields (`body`, `owner_notes`) and say explicitly that they were abbreviated,
offering to dump them in full. Related: [[mail-mafia-project]]
