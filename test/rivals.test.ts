import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwnProspect, stripOwnProspects } from "../src/outreach/rivals.js";

// Real name_keys from the prospects table.
const OURS = [
  "aqua med spa the villages location",
  "vitality medicine",
  "florida dermatologic surgery and aesthetics institute",
  "nuwa world",
  "born again doctor medical center",
];

test("catches a prospect the probe named differently", () => {
  // What the probe actually returned when asked about PRP hair restoration.
  assert.ok(isOwnProspect("Ocala Plastic Surgery & Dermatology (Aqua Med Spa)", OURS));
  assert.ok(isOwnProspect("Vitality Medicine", OURS));
});

test("does not match unrelated businesses that share generic words", () => {
  assert.equal(isOwnProspect("Advanced Aesthetics Med Spa", OURS), false);
  assert.equal(isOwnProspect("Innova Wellness Spa", OURS), false);
  assert.equal(isOwnProspect("Tempus Hair Restoration", OURS), false);
  assert.equal(isOwnProspect("Marion Dermatology", OURS), false);
});

test("strips ours and keeps the rest in order", () => {
  const { kept, removed } = stripOwnProspects(
    ["Tempus Hair Restoration", "Vitality Medicine", "ReGenU"],
    OURS,
  );
  assert.deepEqual(kept, ["Tempus Hair Restoration", "ReGenU"]);
  assert.deepEqual(removed, ["Vitality Medicine"]);
});
