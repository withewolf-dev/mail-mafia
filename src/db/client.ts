import { neon } from "@neondatabase/serverless";
import { requireEnv } from "../env.js";

/**
 * Neon over HTTP — no connection pool to manage, which suits short-lived CLI
 * runs and serverless jobs. DATABASE_URL is the pooled connection string from
 * the Neon dashboard.
 */
let sql: ReturnType<typeof neon> | undefined;

export function db(): ReturnType<typeof neon> {
  return (sql ??= neon(requireEnv("DATABASE_URL")));
}
