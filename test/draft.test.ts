import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFromHtml } from "../src/enrich/scrape.js";
import { assembleBody, violations } from "../src/draft/draft.js";

const input = {
  name: "Glow Med Spa",
  category: "med spa",
  city: "Dubai",
  siteText: "irrelevant for template assembly",
};

test("strips scripts, styles and markup down to readable text", () => {
  const html = `<html><head><style>.a{color:red}</style><script>var x=1</script></head>
    <body><h1>Glow Med Spa</h1><p>Hydrafacial&nbsp;since 2014</p></body></html>`;
  const { text } = extractFromHtml(html, "glowmedspa.ae");
  assert.ok(text.includes("Glow Med Spa"));
  assert.ok(text.includes("Hydrafacial since 2014"));
  assert.ok(!text.includes("color:red"));
  assert.ok(!text.includes("var x"));
});

test("prefers a contact address on the prospect's own domain", () => {
  const html = "contact hello@glowmedspa.ae or the agency at ops@someagency.com";
  const { email, emailSource } = extractFromHtml(html, "glowmedspa.ae");
  assert.equal(email, "hello@glowmedspa.ae");
  assert.equal(emailSource, "domain");
});

test("ignores builder and asset noise that looks like an email", () => {
  const html = "<img src='logo@2x.png'> sentry@wixpress.com";
  assert.equal(extractFromHtml(html, "glowmedspa.ae").email, "");
});

test("falls back to an off-domain address, flagged as scraped", () => {
  const { email, emailSource } = extractFromHtml("reach us at glowspa@gmail.com", "glowmedspa.ae");
  assert.equal(email, "glowspa@gmail.com");
  assert.equal(emailSource, "scraped");
});

test("body embeds the opener and merge fields, nothing else varies", () => {
  const body = assembleBody(input, { subject: "ai answers miss you", opener: "OPENER_HERE" });
  assert.ok(body.startsWith("Hi Glow team,"));
  assert.ok(body.includes("OPENER_HERE"));
  assert.ok(body.includes('"best med spa in Dubai"'));
  assert.ok(body.includes("Glow Med Spa is not being named"));
  assert.ok(body.trimEnd().endsWith("Armstrong - armstrongco.ai"));
});

test("body is plain text — no HTML, no exclamation marks", () => {
  const body = assembleBody(input, { subject: "s", opener: "o" });
  assert.ok(!/<[^>]+>/.test(body));
  assert.ok(!body.includes("!"));
});

test("rejects an opener over the word limit", () => {
  const long = Array.from({ length: 28 }, (_, i) => `word${i}`).join(" ");
  const problems = violations({ subject: "ai answers miss you", opener: long });
  assert.ok(problems.some((p) => p.includes("28 words")));
});

test("rejects subjects that break the house style", () => {
  const opener = "They list dozens of specialties on one page.";
  // Not lowercase, and contains "unlock". Four words is legal, so exactly two.
  const spammy = violations({ subject: "Unlock Your Growth Today", opener });
  assert.ok(spammy.some((p) => p.includes("lowercase")));
  assert.ok(spammy.some((p) => p.includes("unlock")));
  assert.ok(violations({ subject: "a: b", opener }).some((p) => p.includes("colon")));
  assert.ok(violations({ subject: "one", opener }).some((p) => p.includes("3-6")));
});

test("accepts a compliant draft", () => {
  const ok = {
    subject: "euromed's sprawling service list",
    opener: "Your site lists dozens of specialties, which makes it hard to summarise what you are known for.",
  };
  assert.deepEqual(violations(ok), []);
});
