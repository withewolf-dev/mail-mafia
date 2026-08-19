---
name: email-state-machine-model
description: "The governing mental model for all mail-mafia email work — an email is an edge in a state machine, never a broadcast"
metadata: 
  node_type: memory
  type: project
  originSessionId: fc442e59-c164-4697-99c4-8b1ef8fd0032
  modified: 2026-08-15T12:41:50.240Z
---

The design philosophy for [[mail-mafia-project]], from `email_as_a_growth_system.md`:

Every contact occupies exactly one state (`Visitor → Lead → Trial → Activated → Paying → Expanding`, with `Stalled`/`At-risk`/`Churned`/`Won-back` branches). **An email is an edge, not a node** — its only job is to move one person across one transition.

Core rules:
- If you cannot name the state transition an email causes, do not send it.
- Drip = `setTimeout`, trigger = `addEventListener`. Triggers convert 3–5x better. Build a hybrid: drip as default path, triggers interrupt and cancel it.
- Build order by ROI: activation sequence → stall triggers → dunning → expansion triggers → winback → cold outreach → newsletter (last, not first).
- Emails: one CTA, plain text from a person, subject is a promise not a hook, <120 words for anything behavioral, timing relative to the event not the clock, CTA is "reply" not "book a call" while small.
- **Metrics:** open rate is broken (Apple MPP), click rate is weak. Track reply rate, **state transition rate** (the real one), unsubscribe (<0.5%), spam complaints (<0.1%), revenue per recipient.
- Instrument events before writing copy. Delete campaigns that don't move people rather than iterating them.

**Why:** this is the yardstick the user will judge the system by — a feature that can't name its transition doesn't belong.

**How to apply:** when proposing any campaign, sequence, or schema field, state which transition it serves and what its exit/suppression condition is.
