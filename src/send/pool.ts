import type { Inbox } from "./inbox.js";

/** Sends already made today, keyed by inbox id. Swap for Airtable/SQLite later. */
export interface QuotaStore {
  countToday(inboxId: string): Promise<number>;
  record(inboxId: string): Promise<void>;
}

/** Non-persistent. Fine for a CLI run; a scheduled job needs a real store. */
export class InMemoryQuotaStore implements QuotaStore {
  private counts = new Map<string, { day: string; n: number }>();
  private today = () => new Date().toISOString().slice(0, 10);

  async countToday(inboxId: string): Promise<number> {
    const e = this.counts.get(inboxId);
    return e && e.day === this.today() ? e.n : 0;
  }

  async record(inboxId: string): Promise<void> {
    const day = this.today();
    const e = this.counts.get(inboxId);
    this.counts.set(inboxId, e && e.day === day ? { day, n: e.n + 1 } : { day, n: 1 });
  }
}

export class AllInboxesAtCapError extends Error {
  constructor(capacity: number) {
    super(`Every inbox has hit its daily cap (${capacity} sends/day total). Try tomorrow.`);
    this.name = "AllInboxesAtCapError";
  }
}

/**
 * Picks which mailbox sends the next email.
 *
 * Least-recently-used across inboxes under their cap, so volume spreads evenly
 * instead of hammering the first mailbox until it's flagged.
 */
export class InboxPool {
  private lastUsedAt = new Map<string, number>();

  constructor(
    private readonly inboxes: Inbox[],
    private readonly quotas: QuotaStore,
  ) {
    if (inboxes.length === 0) throw new Error("InboxPool needs at least one inbox.");
  }

  /** Total sends available today across the pool. */
  get dailyCapacity(): number {
    return this.inboxes.reduce((n, i) => n + i.dailyCap, 0);
  }

  async next(): Promise<Inbox> {
    const available: Inbox[] = [];
    for (const inbox of this.inboxes) {
      if ((await this.quotas.countToday(inbox.id)) < inbox.dailyCap) available.push(inbox);
    }
    if (available.length === 0) throw new AllInboxesAtCapError(this.dailyCapacity);

    available.sort((a, b) => (this.lastUsedAt.get(a.id) ?? 0) - (this.lastUsedAt.get(b.id) ?? 0));
    const chosen = available[0]!;
    this.lastUsedAt.set(chosen.id, Date.now());
    await this.quotas.record(chosen.id);
    return chosen;
  }
}

/**
 * Wait between sends. Randomised on purpose — a send exactly every 90 seconds
 * is a machine signature, and the fixed interval was one of the things the n8n
 * version couldn't vary.
 */
export function nextDelayMs(minMs = 60_000, maxMs = 180_000): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
