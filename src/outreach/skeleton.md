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
Hey {{owner}},

{{social_proof}}. {{concession}}

{{behaviour_shift}}

So {{when}} I asked one where to go in {{city}} for {{n}} things you do:

{{Service_1}}: {{rivals_1}}. Not you.

{{Service_2}}: {{rivals_2}}. Not you.

{{Service_3}}: {{rivals_3}}. Not you.

{{broad_contrast}}

{{market_stats}}

{{cta}}

{{sender}}
{{company}} - {{domain}}
```

---

## Slots

### 1. `owner`
The person, not the business. `Hey Sualeh,`

**Source:** `prospect.owner_first_name`.
**Physicians take the title instead:** `Hey Dr. Hassanein,` — when the FL DOH
licence profession is a doctor grade (Medical Doctor, Osteopathic Physician) or
the AI Overview role says physician/surgeon/dermatologist. Estheticians, PAs and
studio owners get the first name; "Dr." on a body-sculpting studio owner is
worse than no title.

**Never** `{first_token} team` — that produced "Hi Born team" on the August 15
batch. **Never** send at all without a name: a cold email that cannot greet a
person has no business being in this format.

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
`service_n` is `query.label` (2–3 words), **capitalized** and followed by a colon
(`Hair restoration:`). `rivals_n` is 2–3 competitor names, **shortened to how a
local would say them** — `Gameday Men's Health`, not `Gameday Men's Health – Ocala`.

**Rules:**
- One entry per service: `Service: rivals. Not you.` No arrows, no padding. A
  blank line separates each entry so they stay distinct when a phone wraps them.
- Only names the probe actually returned. Never a plausible-sounding local business.
- Never a name that is also in your prospect list — you'd be telling one client
  their neighbour is winning.
- `Not you.` repeats verbatim on every entry. The repetition is the device; vary
  it and the drumbeat dies.

### 7. `broad_contrast`
The sharpest finding in the email: they rank for the category and vanish on the
procedures. Two sentences, from the category probe.

> Ask for "best med spa in Ocala" and you do come up. So you show up for the
> broad term and disappear on the three procedures people actually book.

**Source:** the `probeCategory` result. This slot is **conditional on the probe
actually saying so.** If the category probe did *not* name them, the contrast is
false and the slot becomes the depth line instead: *"It read about 30 pages to
build those answers. None of them were yours."* Never assert the contrast
because it reads better — it is the one claim in the email an owner can check in
ten seconds.

### 8. `market_stats`
What the missed procedures are worth, so absence has a price attached.

> Hair transplant is an $11B global market growing 22% a year.
> Vaginal rejuvenation is tracking to $14B by 2030.

**Source:** `findMarketStats()` — published figures with a source and URL, never
estimated. One or two lines, on procedures from slot 6 only.
**Rules:** these numbers go to someone who may know their own market better than
we do, so a wrong figure discredits the probe findings, which are the part that
is genuinely theirs and genuinely true. Two solid numbers beat three where one
is invented. If nothing credible was found, drop the slot — the email still
works without it.

### 9. `cta`
Two lines, fixed: one sentence naming what Armstrong does, then one short
question offering the AI Visibility Report. Not a meeting.

> Armstrong helps you get discovered in these AI searches.
> Want the AI Visibility Report for your business?

**Rules:** use these two lines verbatim. Never "losing revenue" — you cannot
see their revenue. The report offered must be sendable within the hour: we hold
every query, every answer and every source, so it is.

---

## Non-negotiables

1. **Every factual sentence traces to evidence.** No claim about revenue,
   rankings, or customer counts.
2. **Plain words.** No "model", "LLM", "GEO", "citation-sourcing", "schema".
3. **70–170 words**, excluding the result lines.
4. **No links, no images, no attachment.** Plain text.
   No em or en dashes anywhere, subject or body - plain hyphens only.
5. **One idea.** Slots 6–8 are one argument, not three.

## When to send nothing

- Named in ≥50% of runs on every query → no story, skip.
- Fewer than two queries with `namedIn === 0` → the result block collapses, skip.
- Someone else in the same city and category has already been mailed → skip.

---

## Worked example

Born Again Doctor, Ocala. Every line below traces to stored evidence: the rating
from the Maps row, the three services from the crawled site, the competitor
names from four real probes, the market figures from published sources.

```
Hey Sualeh,

4.9 stars, 116 Google reviews. Locally you've clearly earned it.

Your patients don't scroll Google the way they used to. A lot of them now ask ChatGPT, Gemini or Perplexity "who's good for this near me" and just go with the answer.

So this morning I asked one where to go in Ocala for three things you do:

Hair restoration: Tempus, ReGenU, Marlene Glass. Not you.

Vaginal rejuvenation: Advanced Aesthetics, Vantage Urologic. Not you.

ED shockwave therapy: Gameday Men's Health, Arviv. Not you.

Ask for "best med spa in Ocala" and you do come up. So you show up for the broad term and disappear on the three procedures people actually book.

Hair transplant is an $11B global market growing 22% a year.
Vaginal rejuvenation is tracking to $14B by 2030.

Want the full breakdown of all four?

Gitartha
Armstrong - armstrongco.ai
```

Prose paragraphs are single lines with **no hard wraps** — the reader's client
wraps to their screen, and baked-in breaks turn into ragged mid-sentence wraps
on a phone. The result block is `Service: rivals. Not you.` entries — service
name capitalized, a colon, no arrows and **no space padding** — with a **blank
line between each entry**. Plain-text email is read in a proportional font
(Gmail etc.), so aligned arrow columns shatter; the colon format and the blank
lines carry the structure instead, and stay legible however a phone wraps them.
(Two short market lines in slot 8 stay on their own lines by design — each is
short enough not to wrap.)

## Subject lines

One fixed structure, no variants:

```
asked ai for {{service}} in {{city}}, {{state}} - got {{rival}}, not you
```

- `{{service}}` and `{{rival}}` come from the same result line - the miss with
  the strongest competitor set. Rival shortened to how a local would say it
  (`VIP`, `macinnis`), lowercase like the rest of the subject.
- `{{city}}, {{state}}` spelled out: `the villages, florida`, `ocala, florida`.
- Plain hyphen, lowercase throughout, no colons, no em dashes.
- Everything in it must be true: the probe really missed them and really named
  the rival. Never pick a rival for the subject that is not in the body.
- If the only usable miss has no nameable rival (all named rivals are our own
  prospects), drop the rival clause instead of inventing one:
  `asked ai for {{service}} in {{city}}, {{state}} - you weren't named`

Examples:

- `asked ai for botox in the villages, florida - got VIP, not you`
- `asked ai for acne treatment in the villages, florida - got macinnis, not you`
- `asked ai for hair restoration in ocala, florida - got regenu, not you`
