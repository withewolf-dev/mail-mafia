# Replicating the Grand Agent in n8n — Armstrong Edition

Two workflows, not one. The screenshot crams all five phases into a single canvas, which is why it can only do 14 emails. Outbound and inbox run on different triggers at different frequencies with different failure modes — they belong in separate workflows.

- `armstrong_outbound.json` — Phases 1–3 (harvest → enrich → draft → send → log)
- `armstrong_inbox.json` — Phases 4–5 (monitor → classify → route → Slack → log)

---

## Setup — 60 to 90 minutes

### 1. Credentials (n8n → Credentials → Add)

| Credential | Type | Config |
|---|---|---|
| Serper | Header Auth | Name `X-API-KEY`, Value = your Serper key |
| Anthropic | Header Auth | Name `x-api-key`, Value = your Anthropic key |
| Gmail | Gmail OAuth2 | Standard OAuth flow |
| Airtable | Airtable Personal Access Token | Scopes: `data.records:read`, `data.records:write`, `schema.bases:read` |
| Slack | Slack API | Bot token, scope `chat:write` |

Two separate Header Auth credentials — the header names differ (`X-API-KEY` vs `x-api-key`). n8n won't warn you if you attach the wrong one; you'll just get a 401 that looks like a bad key.

### 2. Airtable base

Two tables.

**Prospects**
```
place_id (single line, PRIMARY)  name  category  city  country
cluster_id  website  domain  phone  rating (number)  review_count (number)
email  email_source  subject  body  status  last_intent
sent_at (date)  last_event (date)
```

**Suppression**
```
domain (PRIMARY)  email  reason
```

`place_id` must be the primary field — both workflows upsert on it.

### 3. Import and patch

Import each JSON, then find-and-replace `REPLACE_AIRTABLE_BASE_ID` with your base ID (the `app…` string in the Airtable URL) across every Airtable node. Attach credentials to: Serper Places, both Claude nodes, all Gmail nodes, all Airtable nodes, Slack.

Change `https://cal.com/armstrong/visibility-teardown` in the two Gmail reply nodes to your real event URL.

If a node shows "unknown node type" or a parameter looks blank, your n8n is on a different `typeVersion`. Delete that node, add it fresh from the panel, copy the parameters across from the JSON. It happens most often with Switch (v3.2) and Airtable (v2.1).

### 4. Test order

1. Pin `Build Query Matrix` to two queries only. Execute the workflow manually. Confirm Airtable fills.
2. Disable `Send Email`. Run the enrich lane. Read 20 generated bodies in the execution log.
3. Re-enable Gmail, set `Fetch Batch To Send` limit to 3, send to yourself and two friendly addresses.
4. Reply to those three with different intents ("interested", "too expensive", "out of office"). Run the inbox workflow manually and check the routing.
5. Only then turn schedules on.

---

## The patterns worth learning

These five are what separate a workflow that survives 1,000 items from one that survives 14.

### Build LLM payloads in a Code node, not in the HTTP node

Every Claude call here is `Code node → HTTP Request`, where the Code node returns a `payload` object and the HTTP node's body is just `{{ JSON.stringify($json.payload) }}`.

The alternative — writing the JSON body inline in the HTTP node with `{{ }}` expressions inside string fields — means escaping quotes, newlines, and braces inside a prompt that already contains all three. It breaks constantly and the error messages are useless. Build the object in JavaScript where you have real string handling, then serialise once.

### Two Split In Batches loops, not one

`Loop Queries` handles ~100 Serper calls. `Loop Prospects` handles ~40 sends. They're separate because they fail differently: a Serper timeout should retry the query, a Gmail bounce should skip the prospect. Chaining them into one loop means one bad website kills the whole harvest.

Note the output order on Split In Batches v3: **output 0 is "done", output 1 is "loop"**. Getting this backwards is the single most common n8n bug and it presents as "my loop runs once and stops."

### `onError: continueRegularOutput` on every external call

Set on Serper, the website scrape, both Claude calls, all Gmail nodes, all Airtable nodes. Without it, one 403 from one prospect's Cloudflare-protected site aborts the run and you lose the other 39. With it, the bad item flows through with an error payload and the loop continues.

### Enforce the confidence floor in code, not just the prompt

The classifier prompt says "if confidence < 0.8, intent must be UNCLEAR." `Parse Classification` also does:

```js
if ((out.confidence || 0) < 0.8) out.intent = 'UNCLEAR';
```

Prompts are guidance. Code is a guarantee. Anything auto-sending on a model's self-reported confidence needs the floor enforced downstream, because the failure mode is silent — a misread "already have an agency, but call me in March" filed as NOT_INTERESTED kills your best lead and you never see it.

### Strip the quoted thread before classifying

`Parse Reply` cuts the body at `On … wrote:` and `-----Original Message-----`. Without this, the classifier reads your own outbound copy as part of their reply and reliably over-scores intent, because your email is full of enthusiastic buying language.

---

## What I changed from the original workflow

| Original | Here | Why |
|---|---|---|
| Claude researches niches at runtime | Hardcoded query matrix in a Code node | You already know your ICP. An LLM call that returns "med spas" every morning is latency and spend for nothing, and it drifts. |
| Serper `/search` (web results) | Serper `/places` (Google Maps) | You asked for Maps profiles. `/places` gives you website, phone, rating, and review count in one call — the review count is your revenue proxy and your best qualifier. |
| Claude extracts prospects from search results | Deterministic filter in JS | Parsing structured API output with an LLM is the most common waste in these workflows. `/places` already returns clean fields. |
| Claude writes the whole email | Claude writes `subject` + `opener`, template does the rest | Variance across 900 sends is where deliverability and credibility die. Two variable slots gives you personalisation without letting the model invent claims about a medical clinic. |
| Everything to Airtable | Slack for anything needing a human, Airtable for state | You wanted the ping. Airtable is a database, not a notification system. |
| All intents auto-reply | Only INTERESTED and SEND_REPORT auto-reply | See the confidence floor above. |

---

## Where this breaks, honestly

The n8n version is the right thing to build first — you'll see every phase execute, you can debug visually, and you'll understand the shape before you optimise it. Build it. Run it at 40/day.

It breaks at roughly 200 prospects per run, in this order:

1. **Execution timeout.** The enrich lane is serial: scrape (up to 10s) + Claude (2–4s) + Gmail + Airtable + a 90s throttle. That's ~110s per prospect. 40 prospects is 73 minutes. 200 is six hours. n8n Cloud kills long executions, and self-hosted will hold the whole run in memory.
2. **No resume.** Crash at prospect 150 and you restart from the Airtable query. The `status` field mitigates this — already-sent records won't come back — but a partial write leaves records in a limbo state you'll be fixing by hand.
3. **No per-inbox rotation.** The Gmail node has one account. Rotating across 12 inboxes needs a Code node picking an inbox and a Switch fanning to 12 send nodes, which is unmaintainable on a canvas.

The move at that point is to keep the inbox workflow in n8n permanently — it's event-driven, low-volume, integration-heavy, exactly what n8n is best at — and port the outbound lane to the Node/TS service. The Code nodes in `armstrong_outbound.json` are already plain JavaScript with no n8n-specific APIs beyond `$json` and `$('Node').first()`. Lifting them into a script is a copy-paste plus a find-replace on those two accessors. That's deliberate.

Run it in n8n for a week, learn where it hurts, then port the half that hurts.
