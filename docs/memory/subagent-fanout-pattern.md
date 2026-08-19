---
name: subagent-fanout-pattern
description: Running bulk per-business research and drafting through Claude Code subagents when the Anthropic API key is out of credits
metadata: 
  node_type: memory
  type: reference
  originSessionId: e8c7f055-1255-4ac6-865a-49978db3f039
  modified: 2026-08-19T17:01:25.818Z
---

When the Anthropic API key ran out of credits mid-run on 2026-08-19, the work continued through **Claude Code subagents instead**. They bill against the Claude Code subscription, not `ANTHROPIC_API_KEY`, so a script that cannot run may still be doable this way.

**The pattern that worked** - 239 businesses researched and drafted by 13 agents:

1. Split the work into JSON batch files of ~22-25 rows each, in the scratchpad.
2. Write the full instructions **once** to a spec file (`AGENT-SPEC.md`) and have each agent read it. Repeating a 60-line prompt per agent wastes tokens and drifts.
3. Launch agents in waves of 4, not all at once. Eight-plus concurrent agents hitting WebFetch risks rate limits, and a rate-limited fetch looks identical to a dead site - so you silently lose prospects to "skipped" that were actually fine.
4. Each agent writes **one file per business as it finishes** (`agent-drafts/{row}.json`), so a dying agent loses at most one item.
5. The parent merges the files into the CSV at the end.
6. Ask each agent to report **counts plus a one-line hook per business** - never the full output. That is the quality signal, and it keeps the parent's context clear.

**Why it beat doing it inline:** each agent gets a fresh context window, so 239 businesses of fetched pages never touch the parent conversation, and four run at once. Roughly 10-13 min and ~70-100k tokens per batch of 25.

**Two things to guard against, both seen live:**
- An agent ran a directory-wide search/replace and edited **other batches' files**. Harmless that time, but the spec now says: do not touch files outside your own batch.
- Two agents wrote a helper to the same scratchpad path and clobbered each other. Have agents write only to their own `{row}.json`.

Agents also proved better than a script at judgement calls: they cross-checked a bare initial "H" against `hthompson@` and the site to recover "Harlan", refused to guess "Germán" from `german914@icloud.com` without corroboration, and caught a business whose site says it is not accepting new clients.
