import { test } from "node:test";
import assert from "node:assert/strict";
import { pickProcedures, type ServiceMenu } from "../src/outreach/procedures.js";

const menu = (names: [string, "high" | "medium" | "low"][]): ServiceMenu => ({
  category: "med spa",
  procedures: names.map(([name, ticket]) => ({ name, evidence: "https://x", ticket })),
});

test("picks the highest-ticket procedures first", () => {
  const picked = pickProcedures(
    menu([["facial", "low"], ["hair restoration", "high"], ["dermal fillers", "medium"]]),
  );
  assert.equal(picked[0], "hair restoration");
});

test("never picks two procedures about the same thing", () => {
  // The real menu that produced three hair lines in one email.
  const picked = pickProcedures(
    menu([
      ["hair restoration", "high"],
      ["PRP for hair restoration", "high"],
      ["stem cell therapy for hair loss", "high"],
      ["ED shockwave therapy", "high"],
      ["vaginal rejuvenation", "high"],
    ]),
  );
  assert.deepEqual(picked, ["hair restoration", "ED shockwave therapy", "vaginal rejuvenation"]);
});

test("returns fewer than asked rather than repeating a topic", () => {
  const picked = pickProcedures(menu([["hair restoration", "high"], ["hair loss treatment", "high"]]));
  assert.deepEqual(picked, ["hair restoration"]);
});
