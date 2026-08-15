import { test } from "node:test";
import assert from "node:assert/strict";
import { AllInboxesAtCapError, InboxPool, InMemoryQuotaStore, nextDelayMs } from "../src/send/pool.js";
import type { Inbox } from "../src/send/inbox.js";

const inbox = (id: string, dailyCap = 2): Inbox => ({
  id,
  address: `${id}@example.com`,
  fromName: "Danish",
  smtp: { host: "smtp.example.com", port: 587, user: id, pass: "x" },
  dailyCap,
});

test("spreads sends across inboxes instead of draining the first", async () => {
  const pool = new InboxPool([inbox("a"), inbox("b")], new InMemoryQuotaStore());
  const picked = [await pool.next(), await pool.next(), await pool.next(), await pool.next()];
  const ids = picked.map((i) => i.id);
  assert.equal(ids.filter((i) => i === "a").length, 2);
  assert.equal(ids.filter((i) => i === "b").length, 2);
});

test("refuses to send once every inbox is at its daily cap", async () => {
  const pool = new InboxPool([inbox("a", 1)], new InMemoryQuotaStore());
  await pool.next();
  await assert.rejects(() => pool.next(), AllInboxesAtCapError);
});

test("reports total daily capacity across the pool", () => {
  const pool = new InboxPool([inbox("a", 20), inbox("b", 30)], new InMemoryQuotaStore());
  assert.equal(pool.dailyCapacity, 50);
});

test("delay is randomised, not a fixed interval", () => {
  const samples = new Set(Array.from({ length: 50 }, () => nextDelayMs()));
  assert.ok(samples.size > 40, "delays should vary between sends");
  for (const ms of samples) {
    assert.ok(ms >= 60_000 && ms <= 180_000, `${ms} outside the configured window`);
  }
});
