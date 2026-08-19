---
name: cold-email-hard-rules
description: "Non-negotiable constraints for mail-mafia — domain separation, code-enforced confidence floor, and the known n8n scaling ceiling"
metadata: 
  node_type: memory
  type: constraint
  originSessionId: fc442e59-c164-4697-99c4-8b1ef8fd0032
  modified: 2026-08-15T12:42:14.508Z
---

Constraints for [[mail-mafia-project]] that must survive any rewrite or port:

1. **Cold outbound and product email never share a sending domain.** Cold email will eventually collect spam complaints; contain that damage on a throwaway domain, nowhere near the domain paying customers get invoices and reports on.
2. **Enforce the LLM confidence floor in code, not just the prompt.** `Parse Classification` does `if ((out.confidence || 0) < 0.8) out.intent = 'UNCLEAR'`. Prompts are guidance, code is a guarantee — the failure mode is silent (a "call me in March" filed as NOT_INTERESTED kills the best lead invisibly). Only INTERESTED / SEND_REPORT auto-reply; everything else goes to a human via Slack.
3. **Strip the quoted thread before classifying.** Cut at `On … wrote:` / `-----Original Message-----`, or the classifier reads your own enthusiastic outbound copy and over-scores intent.
4. **`onError: continueRegularOutput` on every external call** (Serper, scrape, Claude, Gmail, Airtable) — one Cloudflare 403 must not abort the other 39 prospects.
5. **Build LLM payloads in a Code node, then `JSON.stringify`** — never inline `{{ }}` expressions in an HTTP node's JSON body.
6. **n8n's known ceiling: ~200 prospects/run.** Enrich is serial at ~110s/prospect (73 min for 40, six hours for 200), there's no resume after a crash, and no per-inbox rotation. The plan: keep the **inbox** workflow in n8n permanently (event-driven, integration-heavy) and **port the outbound lane to a Node/TS service**. The Code nodes are already plain JS — lifting them is a copy-paste plus find-replace on `$json` and `$('Node').first()`. That was deliberate.
7. n8n gotcha: Split In Batches v3 — **output 0 is "done", output 1 is "loop"**. Reversing it looks like "my loop runs once and stops."

**How to apply:** when building or porting, check any proposal against 1, 2, and 6 first — those are the ones that cost real money or real leads when broken.
