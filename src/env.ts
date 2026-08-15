import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load .env from the project root, whatever directory the entry point was run
 * from. Imported for its side effect by anything that reads process.env.
 *
 * Real environment variables always win — this only fills in what isn't set,
 * so a key exported in your shell (or injected by CI) is never clobbered.
 */
const envPath = resolve(import.meta.dirname, "..", ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill it in, or export ${name} in your shell.`,
    );
  }
  return value;
}
