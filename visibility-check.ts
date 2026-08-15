import "./src/env.js";
import Anthropic from "@anthropic-ai/sdk";
const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const r = await c.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 900,
  tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
  messages: [{ role: "user", content:
    "Who are the best cosmetic dentists in New York? Name specific practices." }],
});
const text = r.content.filter((b) => b.type === "text").map((b: any) => b.text).join("");
console.log(text.slice(0, 1400));
console.log("\n--- is our prospect named? ---");
console.log(/preferred dental/i.test(text) ? "YES — Preferred Dental Care appears" : "NO — Preferred Dental Care does not appear");
