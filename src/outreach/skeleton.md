# Cold email skeleton — the "probe result" format

The shape that worked on Born Again Doctor. Nine slots, fixed order. Every slot
is filled from data the pipeline already gathered — nothing here is invented at
write time.

The order is load-bearing. Concede before you critique, explain the behaviour
before you show the test, and put the compliment *inside* the diagnosis. Move
those and the email reads as an attack.

---

## The skeleton

```
Hey {{business_short}},

{{social_proof}}. {{concession}}

{{behaviour_shift}}

So {{when}} I asked one where to go in {{city}} for {{n}} things you do:

  {{service_1}}  ->  {{rivals_1}}. Not you.
  {{service_2}}  ->  {{rivals_2}}. Not you.
  {{service_3}}  ->  {{rivals_3}}. Not you.

{{depth_stat}}

{{diagnosis}}

{{cta}}

{{sender}}
{{company}} - {{domain}}
```

---

## Slots

### 1. `business_short`
Their name with the Maps suffix stripped. `Born Again Doctor-Medical Center` →
`Born Again Doctor`. Never `{first_token} team` — that produces "Hi Born team".

**Source:** `prospect.name`, cut at the first `-`, `,` or `|`.

### 2. `social_proof`
Hard numbers only. `4.9 stars, 116 Google reviews`.

**Source:** `prospect.rating`, `prospect.reviewCount`.
**Fallback:** if under 20 reviews or absent, cut slots 1–2 down to `Hey {{name}},`
and open on the behaviour shift. A weak number used as proof reads as sarcasm.

### 3. `concession`
One short clause granting they're genuinely good — *offline*. This is what buys
permission for everything after it.

> Locally you've clearly earned it.

**Rules:** under 8 words. Never "impressive", "amazing", "love what you're
doing". It concedes a fact, it doesn't compliment.

### 4. `behaviour_shift`
Why any of this matters, in their language. Names the platforms — never "AI
models", "LLMs", "generative engines".

> Your patients don't scroll Google the way they used to. A lot of them now ask
> ChatGPT, Gemini or Perplexity "who's good for this near me" and just go with
> the answer.

**Rules:** swap `patients` for `customers`/`clients` by vertical. Two sentences
max. This is the only slot that's near-identical across prospects — it's
explaining the market, not them.

### 5. `when`
`this morning`, `yesterday`. Must be true and recent.

**Source:** `evidence.observedAt`. If probe evidence is stale (>7 days), re-run
before sending — do not fudge this word.

### 6. The result lines — `service_n` / `rivals_n`
Three is the number. Two feels thin, four reads as a report.

**Source:** `ProbeResult[]` where `namedIn === 0`, richest competitor sets first.
`service_n` is `query.label` (2–3 words). `rivals_n` is 2–3 competitor names,
**shortened to how a local would say them** — `Gameday Men's Health`, not
`Gameday Men's Health – Ocala`.

**Rules:**
- Only names the probe actually returned. Never a plausible-sounding local business.
- Never a name that is also in your prospect list — you'd be telling one client
  their neighbour is winning.
- `Not you.` repeats verbatim on every line. The repetition is the device; vary
  it and the drumbeat dies.

### 7. `depth_stat`
One quantified escalation past "you weren't named".

> It read about 30 pages to build those answers. None of them were yours.

**Source:** `sum(sourcesRead.length)`, and `siteWasRead === false` across all
queries. Round hard — `about 30`, not `31`.
**Fallback:** if their site *was* read, this becomes the stronger line: *"It read
your site and still recommended someone else."*

### 8. `diagnosis`
The turn. Compliment their content, then name the structural gap. This is the
only slot carrying an opinion, and it must land as the *reason* for slot 6, not
a new topic.

> That isn't a content problem - your {{page}} is more detailed than any page it
> did recommend. Your site just never ties what you do to where you do it.

**Source:** `facts.contentGaps` + the deepest page found.
**Rules:** never reduce the fix to one word ("just add Ocala") — that makes it
sound like an afternoon's work and there's no reason to reply. Keep it
structural.

### 9. `cta`
A named artifact plus what's inside it. Not a meeting.

> Want the full AI visibility report? Every query, the pages it read, and which
> competitor is getting the booking instead.

**Rules:** never "losing revenue" — you can't see their revenue. "Which
competitor is getting the booking instead" says the same thing and is backed by
data you hold. Whatever you name here, you must be able to send within an hour.

---

## Non-negotiables

1. **Every factual sentence traces to evidence.** No claim about revenue,
   rankings, or customer counts.
2. **Plain words.** No "model", "LLM", "GEO", "citation-sourcing", "schema".
3. **70–170 words**, excluding the result lines.
4. **No links, no images, no attachment.** Plain text.
5. **One idea.** Slots 6–8 are one argument, not three.

## When to send nothing

- Named in ≥50% of runs on every query → no story, skip.
- Fewer than two queries with `namedIn === 0` → the result block collapses, skip.
- Someone else in the same city and category has already been mailed → skip.

---

## Worked example

```
Hey Born Again Doctor,

4.9 stars, 116 Google reviews. Locally you've clearly earned it.

Your patients don't scroll Google the way they used to. A lot of
them now ask ChatGPT, Gemini or Perplexity "who's good for this
near me" and just go with the answer.

So this morning I asked one where to go in Ocala for three things
you do:

  hair restoration       ->  Tempus, ReGenU, Marlene Glass. Not you.
  vaginal rejuvenation   ->  Advanced Aesthetics, Vantage Urologic. Not you.
  ED shockwave therapy   ->  Gameday Men's Health, Arviv. Not you.

It read about 30 pages to build those answers. None of them
were yours.

That isn't a content problem - your vaginal rejuvenation page is
more detailed than any page it did recommend. Your site just never
ties what you do to where you do it.

Want the full AI visibility report? Every query, the pages it read,
and which competitor is getting the booking instead.

Danish
Armstrong - armstrongco.ai
```

## Subject lines

Pull from the email's own strongest line; never invent a new idea. Three to
five, lowercase, no colons.

- `you're missing from 3 of 4 AI searches`
- `Ocala hair restoration + AI search`
- `4.9 stars, invisible to ChatGPT`
- `quick idea for {{business_short}}`
