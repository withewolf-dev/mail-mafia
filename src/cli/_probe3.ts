import "../env.js";
import Anthropic from "@anthropic-ai/sdk";
const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const QUERIES: [string, string][] = [
  ["med spa", "What is the best med spa in The Villages, Florida? Name specific businesses."],
  ["chemical peel", "Where can I get a chemical peel or VI Peel in The Villages, Florida? Name specific businesses."],
  ["coolsculpting", "Where can I get CoolSculpting in The Villages, Florida? Name specific businesses."],
  ["microneedling", "Where can I get microneedling in The Villages, Florida? Name specific businesses."],
];
for (const [label, q] of QUERIES) {
  const r = await c.messages.create({
    model: "claude-sonnet-5", max_tokens: 1000,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
    messages: [{ role: "user", content: q }],
  });
  let text = ""; const src = new Set<string>();
  for (const b of r.content as any[]) {
    if (b.type === "text") text += b.text;
    if (b.type === "web_search_tool_result") for (const i of b.content ?? []) if (i?.url) src.add(i.url);
  }
  const named = /aqua\s*med\s*spa/i.test(text);
  const ours = [...src].some(u => /aquamedspaocala|ocalaplasticsurgery/i.test(u));
  console.log(`\n### ${label}  -> ${named ? "NAMED" : "NOT NAMED"} | own site read: ${ours ? "yes" : "no"} | ${src.size} sources`);
  console.log("   " + [...text.matchAll(/\*\*([^*]{3,42})\*\*/g)].map(m=>m[1]).slice(0,5).join(" | "));
}
