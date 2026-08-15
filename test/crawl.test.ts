import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLinks } from "../src/enrich/crawl.js";

const html = `
  <a href="/about-us">About</a>
  <a href="/services/injectables">Services</a>
  <a href="/blog/2024/summer">Blog</a>
  <a href="/privacy">Privacy</a>
  <a href="https://facebook.com/them">FB</a>
  <a href="/brochure.pdf">PDF</a>
  <a href="mailto:hi@them.com">Email</a>
  <a href="/our-team">Team</a>`;

test("follows only useful same-site pages", () => {
  const links = pickLinks(html, "https://them.com/");
  assert.ok(links.some((l) => l.includes("/about-us")));
  assert.ok(!links.some((l) => /blog|privacy|facebook|\.pdf|mailto/.test(l)));
});

test("prefers about over services over team", () => {
  const links = pickLinks(html, "https://them.com/");
  assert.ok(links[0]!.includes("/about-us"));
});

test("caps how many pages it will follow", () => {
  assert.ok(pickLinks(html, "https://them.com/").length <= 3);
});
