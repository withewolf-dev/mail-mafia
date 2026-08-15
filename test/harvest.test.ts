import { test } from "node:test";
import assert from "node:assert/strict";
import { MATRIX, buildQueries } from "../src/harvest/query-matrix.js";
import { dedupeByDomain, domainOf, qualify } from "../src/harvest/qualify.js";
import type { SerperPlace } from "../src/harvest/serper.js";

const source = buildQueries()[0]!;

const place = (over: Partial<SerperPlace> = {}): SerperPlace => ({
  title: "Glow Med Spa",
  website: "https://www.glowmedspa.ae/book",
  rating: 4.7,
  ratingCount: 132,
  cid: "123",
  ...over,
});

test("query matrix is the full services x cities cross product", () => {
  const expected = MATRIX.reduce((n, b) => n + b.services.length * b.cities.length, 0);
  const queries = buildQueries();
  assert.equal(queries.length, expected);
  assert.equal(queries[0]!.query, "company formation in Dubai");
  // Every Serper call costs a credit — keep the cost of a run visible.
  assert.ok(queries.length < 200, `${queries.length} queries per run is a lot of credits`);
});

test("keeps a business that clears every bar", () => {
  assert.equal(qualify([place()], source).length, 1);
});

test("drops businesses with no website — nowhere to scrape, no email", () => {
  assert.equal(qualify([place({ website: undefined })], source).length, 0);
});

test("drops thin review counts and weak ratings", () => {
  assert.equal(qualify([place({ ratingCount: 14 })], source).length, 0);
  assert.equal(qualify([place({ rating: 3.9 })], source).length, 0);
});

test("drops national chains regardless of their numbers", () => {
  const chain = place({ title: "Ideal Image Dubai", rating: 4.9, ratingCount: 900 });
  assert.equal(qualify([chain], source).length, 0);
});

test("normalises the domain off the website URL", () => {
  const [p] = qualify([place()], source);
  assert.equal(p!.domain, "glowmedspa.ae");
});

test("skips unparseable websites instead of guessing", () => {
  assert.equal(domainOf("not a url"), null);
  assert.equal(qualify([place({ website: "not a url" })], source).length, 0);
});

test("dedupes the same business found under several queries", () => {
  const twice = qualify([place(), place({ title: "Glow Med Spa JLT" })], source);
  assert.equal(twice.length, 2);
  assert.equal(dedupeByDomain(twice).length, 1);
});
