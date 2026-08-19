---
name: mail-mafia-stack-decision
description: "mail-mafia uses plain TypeScript + the Anthropic SDK — no agent framework; Mastra, AI SDK, Agent SDK and Managed Agents were all evaluated and rejected"
metadata: 
  node_type: memory
  type: decision
  originSessionId: fc442e59-c164-4697-99c4-8b1ef8fd0032
  modified: 2026-08-15T15:06:35.482Z
---

**Decided 2026-08-15: plain TypeScript + `@anthropic-ai/sdk`. No agent framework.** This was settled after evaluating the alternatives; do not reopen it without a new reason.

| Option | Why rejected |
|---|---|
| **Claude Agent SDK** | Claude Code as a library — filesystem, bash, subagents. Built for coding agents, wrong shape for an email pipeline. |
| **Managed Agents** | Hosted sandbox + agent loop for open-ended sessions. mail-mafia's loop is deterministic; you'd pay for a sandbox to run a `for` loop. |
| **Vercel AI SDK** | Legitimate middle option — `generateObject` + Zod, prompt caching reachable, provider-portable. Rejected because it optimizes the easy part (two model calls) and does nothing for the hard part (resume, throttling, rotation, scheduling), and provider portability is worth ~nothing when the prompts are Claude-tuned. |
| **Mastra** | The strongest candidate — its typed durable workflows, Studio run inspector, and built-in scheduling map well onto the pipeline and would replace the visual debugging lost when leaving n8n. Rejected for now: another abstraction over two Claude calls, framework churn at the center of a system that sends real email, and the pipeline is only ~7 steps. Reconsider only at the pipeline-shell stage. |

**Why it holds:** the AI surface is exactly two Claude calls (draft, classify). The n8n Code nodes were written as portable plain JavaScript on purpose, so the port is mostly copy-paste. Nothing else earns a dependency at the center.

**Note:** Mastra has its own model router — it is no longer built on the Vercel AI SDK, and its docs say not to install AI SDK packages. Verify Mastra's API against current docs if it ever comes back up; it churns.

**How to apply:** if asked "should we use X framework", the answer is no unless X solves durable execution *and* the pipeline shell is the work at hand. See [[mail-mafia-project]].
