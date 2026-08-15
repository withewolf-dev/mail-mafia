/**
 * Classify a single reply from the command line, so you can sanity-check the
 * classifier against real replies before it ever touches the inbox.
 *
 *   npm run classify -- "too expensive, but check back in March"
 *   pbpaste | npm run classify
 *
 * Needs ANTHROPIC_API_KEY. Reads nothing else and writes nothing anywhere.
 */
import { classifyReply } from "../classify.js";
import { routeIntent } from "../routing.js";
import { parseReply } from "../parse-reply.js";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const text = process.argv.slice(2).join(" ").trim() || (await readStdin()).trim();

if (!text) {
  console.error('usage: npm run classify -- "their reply text"   (or pipe it on stdin)');
  process.exit(1);
}

// Run it through the real parser so the quoted-thread strip is exercised too.
const reply = parseReply({
  id: "cli",
  threadId: "cli",
  text,
  payload: { headers: [{ name: "From", value: "prospect@example.com" }] },
});

const classification = await classifyReply(reply);
const action = routeIntent(classification);

console.log(JSON.stringify({ reply: reply.replyText, classification, action }, null, 2));
