/**
 * Reflow stored draft bodies into the proportional-font-safe shape. Content is
 * preserved exactly — only whitespace changes. Unlike write-emails, this does
 * NOT re-probe or re-compose, so it is instant and never changes a claim.
 *
 *   npx tsx src/cli/reflow-drafts.ts            # apply to every drafted body
 *   npx tsx src/cli/reflow-drafts.ts --dry      # preview, store nothing
 *   npx tsx src/cli/reflow-drafts.ts --only 1 3 # just these ids
 */
import "../env.js";
import { db } from "../db/client.js";
import { reflowBody } from "../outreach/reflow.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const onlyArg = args.indexOf("--only");
const onlyIds =
  onlyArg >= 0 ? args.slice(onlyArg + 1).filter((a) => /^\d+$/.test(a)) : [];

const rows = (
  onlyIds.length
    ? await db()`select id, body from prospects where id = any(${onlyIds}::bigint[]) and body is not null order by id`
    : await db()`select id, body from prospects where body is not null order by id`
) as unknown as { id: string; body: string }[];

let changed = 0;
for (const row of rows) {
  const next = reflowBody(row.body);
  if (next === row.body) {
    console.log(`#${row.id}  unchanged (already clean)`);
    continue;
  }
  changed++;
  console.log(`#${row.id}  reflowed`);
  if (!dry) {
    await db()`
      update prospects
         set body = ${next},
             opener = ${next.split("\n\n")[1] ?? null},
             updated_at = now()
       where id = ${row.id}`;
  }
}

console.log(`\n${changed}/${rows.length} ${dry ? "would change" : "reflowed and stored"}.`);
