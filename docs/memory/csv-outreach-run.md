---
name: csv-outreach-run
description: "The 2026-08-19 campaign - 260 curiosity-format emails sent from a CSV, with state in the CSV rather than Neon"
metadata: 
  node_type: memory
  type: project
  originSessionId: e8c7f055-1255-4ac6-865a-49978db3f039
  modified: 2026-08-19T17:01:07.199Z
---

On 2026-08-19 the first real outreach campaign went out: **260 cold emails** from `csv/usa-companies-enriched-v2-curiosity.csv` (406 rows, sourced from the prospector export), plus 9 sent earlier the same day from Neon. 2 failed on malformed addresses.

**State lives in the CSV, not Neon.** Gitartha explicitly chose this ("lets keep neon table out of it"). Columns written by the pipeline:

- `email_subject`, `email_body` - the draft
- `email_note` - why a row was skipped
- `email_hook` - the distinctive client the email was built around (one line; scan this to review hundreds of emails quickly)
- `send_flag` - `NO EMAIL ADDRESS` / `vendor/placeholder inbox` / `no owner name`
- `send_status`, `send_id` (Resend message id), `sent_at`

`src/cli/send-csv.ts` does the sending: waves with configurable gap, jittered 8-20s pauses inside a wave, and it **writes the CSV after every single send**, so a row carrying a `send_id` is never re-sent and an interrupted run resumes cleanly. Backup taken to `csv/.pre-send-backup.csv` before the run.

Final: 276 drafted of 406 rows, 260 sent, 16 blocked on the recipient. The 130 undrafted break down as 58 unfetchable sites (mostly 403 bot blocks - possibly recoverable via Firecrawl, which renders JS), and 72 missing a website, a name, or an email outright.

**Open follow-ups:** replies land at `gitartha@armstrongco.ai` and every one is someone expecting a free AI Visibility Report (the probe pipeline produces one in ~9 min). Addresses were never verified - see [[csv-data-quality]]. Sending pace was compressed on request from 30-minute wave gaps to none; the domain went from 9 lifetime emails to 269 in a day, which is a deliverability risk that was flagged and overridden.

See [[curiosity-email-format]] for what these emails say, [[subagent-fanout-pattern]] for how they were written.
