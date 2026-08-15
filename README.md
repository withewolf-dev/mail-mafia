# mail-mafia

An experiment in building an agentic email system — harvest leads, reach out, classify what comes back, and move people toward becoming clients.

Right now this repo is the spec, not the system. Four files:

| File | What it is |
|---|---|
| `email_as_a_growth_system.md` | The strategy primer. The state-machine model that governs everything else. |
| `n8n_replication_guide.md` | Setup, test order, and the patterns that make the workflows survive 1,000 items. |
| `armstrong_outbound.json` | n8n workflow — harvest → qualify → enrich → draft → send → log. Daily. |
| `armstrong_inbox.json` | n8n workflow — monitor → classify → route → notify → log. Every 30 min. |

## The one idea

An email is an **edge in a state machine**, not a broadcast. Its whole job is to move one person across one transition.

> If you cannot name the state transition an email is causing, do not send it.

Everything else — drips, triggers, suppression, metrics — falls out of that. `email_as_a_growth_system.md` has the long version.

## Getting the workflows running

See `n8n_replication_guide.md`. Roughly 60–90 minutes: add credentials, create the two Airtable tables, import both JSONs, find-and-replace `REPLACE_AIRTABLE_BASE_ID`, then follow the test order — **pin the query matrix to two queries and send to yourself before turning any schedule on.**

## Rules that don't bend

1. **Cold outbound and product email never share a sending domain.** Cold mail eventually collects complaints. Keep that damage away from the domain paying customers get invoices on.
2. **Enforce the model's confidence floor in code, not just the prompt.** Only `INTERESTED` and `SEND_REPORT` auto-reply; everything else goes to a human. A misread "call me in March" filed as not-interested fails silently, and silent failures cost the best leads.
3. **`onError: continueRegularOutput` on every external call.** One Cloudflare 403 must not take down the other 39 prospects.

## Where this goes

n8n is the learn-first stage, and it has a ceiling at roughly 200 prospects per run — the enrich lane is serial at ~110s each, there's no resume after a crash, and no per-inbox rotation. The plan is to keep the inbox workflow in n8n permanently (event-driven, integration-heavy, exactly what it's good at) and port the outbound lane to a Node/TS service. The Code nodes are already plain JavaScript for that reason.

Run it in n8n for a week, learn where it hurts, then port the half that hurts.
