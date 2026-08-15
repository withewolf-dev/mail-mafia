import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReply, type RawMessage } from "../src/parse-reply.js";
import { applyConfidenceFloor } from "../src/classify.js";
import { routeIntent } from "../src/routing.js";

function msg(over: Partial<RawMessage> = {}): RawMessage {
  return {
    id: "m1",
    threadId: "t1",
    payload: {
      headers: [
        { name: "From", value: "Dr Sara Khan <sara@glowmedspa.ae>" },
        { name: "Subject", value: "Re: ai search visibility" },
      ],
    },
    ...over,
  };
}

test("extracts sender email and domain from a display-name From header", () => {
  const r = parseReply(msg({ text: "sure, send it over" }));
  assert.equal(r.email, "sara@glowmedspa.ae");
  assert.equal(r.domain, "glowmedspa.ae");
});

test("strips the quoted thread so only their words reach the classifier", () => {
  const r = parseReply(
    msg({
      text: [
        "not interested right now.",
        "",
        "On Tue, 12 Aug 2026 at 09:01, Danish <danish@armstrongco.ai> wrote:",
        "> Want the 12-query breakdown showing exactly where you are invisible?",
        "> Free, takes me ten minutes.",
      ].join("\n"),
    }),
  );
  assert.equal(r.replyText, "not interested right now.");
  assert.ok(!r.replyText.includes("12-query"));
});

test("strips Outlook-style quoted originals too", () => {
  const r = parseReply(
    msg({ text: "pls remove me\n-----Original Message-----\nFrom: Danish" }),
  );
  assert.equal(r.replyText, "pls remove me");
});

test("falls back to stripped html when there is no text part", () => {
  const r = parseReply(msg({ html: "<div><p>call me Thursday</p></div>" }));
  assert.equal(r.replyText, "call me Thursday");
});

test("confidence floor rewrites a confident-looking label to UNCLEAR", () => {
  const c = applyConfidenceFloor({
    intent: "NOT_INTERESTED",
    objection_type: null,
    confidence: 0.62,
    suggested_reply: "",
  });
  assert.equal(c.intent, "UNCLEAR");
});

test("confidence floor leaves a clear label alone", () => {
  const c = applyConfidenceFloor({
    intent: "INTERESTED",
    objection_type: null,
    confidence: 0.94,
    suggested_reply: "",
  });
  assert.equal(c.intent, "INTERESTED");
});

test("only INTERESTED and SEND_REPORT auto-reply", () => {
  const auto = (intent: Parameters<typeof routeIntent>[0]["intent"]) =>
    routeIntent({ intent, objection_type: null, confidence: 1, suggested_reply: "" })
      .kind === "auto_reply";

  assert.ok(auto("INTERESTED"));
  assert.ok(auto("SEND_REPORT"));
  for (const i of ["OBJECTION", "REFERRAL", "OOO", "NOT_INTERESTED", "UNCLEAR"] as const) {
    assert.ok(!auto(i), `${i} must not auto-reply`);
  }
});
