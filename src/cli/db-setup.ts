/**
 * Create the tables. Safe to re-run — everything is `if not exists`.
 *
 *   npx tsx src/cli/db-setup.ts
 */
import "../env.js";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { requireEnv } from "../env.js";

const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

// The HTTP driver runs one statement per call, so split on statement boundaries.
const statements = schema
  .split(/;\s*$/m)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);

const sql = neon(requireEnv("DATABASE_URL"));

for (const statement of statements) {
  await sql.query(statement);
  console.log(`  ok  ${statement.split("\n")[0]!.slice(0, 70)}`);
}

const rows = (await sql`
  select table_name
    from information_schema.tables
   where table_schema = 'public'
     and table_name in ('prospects', 'suppression', 'sends')`) as { table_name: string }[];

console.log(`\n${rows.length}/3 tables present: ${rows.map((r) => r.table_name).sort().join(", ")}`);
