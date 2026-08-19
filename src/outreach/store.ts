import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SourcePage } from "./crawl.js";

/**
 * Crawled pages on disk: crawl-sites/<domain>/<page>.md
 *
 * A working folder, not a datastore — readable, greppable, and easy to throw
 * away when this moves to Neon.
 */
export const ROOT = resolve(process.cwd(), "crawl-sites");

const dirFor = (domain: string): string =>
  join(ROOT, domain.replace(/^www\./, "").toLowerCase());

/** Readable filename from the URL path, numbered to keep richest-first order. */
export function fileNameFor(url: string, index: number): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep the raw string */
  }
  const slug =
    path
      .replace(/^\/|\/$/g, "")
      .replace(/[^a-zA-Z0-9/-]/g, "-")
      .replace(/\//g, "--")
      .replace(/-+/g, "-")
      .slice(0, 60) || "index";
  return `${String(index + 1).padStart(2, "0")}-${slug}.md`;
}

export async function savePages(domain: string, pages: SourcePage[]): Promise<string> {
  const dir = dirFor(domain);
  // Wipe first, so a re-crawl that finds fewer pages doesn't leave stale ones.
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  await Promise.all(
    pages.map((page, i) =>
      writeFile(
        join(dir, fileNameFor(page.url, i)),
        `<!-- ${page.url} -->\n# ${page.title}\n\n${page.text}\n`,
        "utf8",
      ),
    ),
  );
  return dir;
}

/**
 * Drop unpaired UTF-16 surrogates.
 *
 * A half-emoji left behind by a scraped page is not valid UTF-8, so JSON.stringify
 * emits a lone surrogate and the Anthropic API rejects the whole request body with
 * `400 no low surrogate in string`. Goldfingers Aesthetics failed exactly this way.
 * The character is already meaningless on its own, so dropping it loses nothing.
 */
export function stripLoneSurrogates(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "",
  );
}

export async function loadPages(domain: string): Promise<SourcePage[]> {
  const dir = dirFor(domain);
  if (!existsSync(dir)) return [];

  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  return Promise.all(
    files.map(async (file) => {
      const raw = await readFile(join(dir, file), "utf8");
      const url = raw.match(/^<!-- (.*?) -->/)?.[1] ?? "";
      const title = raw.match(/^# (.*)$/m)?.[1] ?? "";
      const text = raw.replace(/^<!-- .*? -->\n# .*\n\n/, "").trimEnd();
      return {
        url,
        title: stripLoneSurrogates(title),
        text: stripLoneSurrogates(text),
      };
    }),
  );
}

/** Domains already crawled. */
export async function listSites(): Promise<string[]> {
  if (!existsSync(ROOT)) return [];
  const entries = await readdir(ROOT, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}
