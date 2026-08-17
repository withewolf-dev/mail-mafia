import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

/**
 * Google's AI Overview, read from a real browser.
 *
 * The search API does not return AI Overviews, and the Overview is the only
 * place some facts surface in one piece — it fans out over Google's index and
 * reads whole pages, where our snippet pipeline sees 160 characters.
 *
 * The cost is that Google does not want to be automated. A fresh headless
 * Chromium is served /sorry/index on the first request, and so is a headed real
 * Chrome with no history. What gets through is a browser carrying a normal
 * profile — consent cookie, some history — which is why this keeps a persistent
 * profile directory and, on the first block, hands you the window to clear the
 * check yourself. After that the cookie persists and runs are unattended until
 * Google decides otherwise.
 *
 * Treat what comes out of here as a lead, not a fact: the Overview is a
 * synthesis and it is sometimes wrong. It named Kristine Krever as FloriDerm's
 * owner off one stale aggregator record.
 */
export const PROFILE_DIR = join(homedir(), ".mail-mafia", "chrome-profile");
export const SHOT_DIR = resolve(process.cwd(), "ai-overviews");

const BLOCK_MARKER = "/sorry/";

/**
 * Just enough of a DOM node to climb the tree inside `evaluate`.
 *
 * Declared here rather than pulling the DOM lib into tsconfig: this is a Node
 * service, and making `document` typecheck everywhere to satisfy two callbacks
 * is a bad trade. These types are erased when the function is serialised into
 * the page anyway.
 */
interface ClimbNode {
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
  parentElement: ClimbNode | null;
  innerText: string;
}

export interface OverviewCapture {
  query: string;
  /** Absolute path to the PNG, or null when there was nothing to shoot. */
  screenshotPath: string | null;
  /** The Overview's text as rendered, for the record. */
  text: string | null;
  /** Result URLs cited by the Overview, when they can be read off the DOM. */
  sources: string[];
  status: "ok" | "no-overview" | "blocked";
}

export interface BrowserOptions {
  /**
   * Attach to a Chrome you started yourself with
   * `--remote-debugging-port=9222`. Uses your real, logged-in session, which is
   * the reliable way past the bot check — at the cost of driving your browser.
   */
  cdpPort?: number;
  /** Show the window. Required the first time, to clear the bot check by hand. */
  headed?: boolean;
  /** Seconds to wait for a human to clear a challenge before giving up. */
  unblockTimeoutSec?: number;
}

export async function openBrowser(options: BrowserOptions = {}): Promise<BrowserContext> {
  if (options.cdpPort) {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${options.cdpPort}`);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Chrome is running on that port but has no browser context open.");
    return context;
  }

  await mkdir(PROFILE_DIR, { recursive: true });
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !options.headed,
    channel: "chrome",
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1400, height: 1600 },
    // Chrome advertises itself as automated by default; Google reads it.
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

/** Google's cookie wall, when it appears. Harmless if it doesn't. */
async function acceptConsent(page: Page): Promise<void> {
  for (const label of ["Accept all", "I agree", "Reject all"]) {
    const button = page.getByRole("button", { name: label });
    if (await button.first().isVisible().catch(() => false)) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(1500);
      return;
    }
  }
}

/**
 * Wait out a bot check with a human at the keyboard.
 *
 * Returns false when the window is headless (nobody can solve it) or the wait
 * elapsed. Never tries to defeat the check itself — that is Google's call to
 * make, and a solved-by-hand cookie is what makes later runs work.
 */
async function waitForHuman(page: Page, timeoutSec: number): Promise<boolean> {
  console.log(
    `\n  Google is showing a bot check. Clear it in the open window — ` +
      `waiting up to ${timeoutSec}s.\n`,
  );
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    if (!page.url().includes(BLOCK_MARKER)) {
      console.log("  Cleared. Continuing.\n");
      return true;
    }
  }
  return false;
}

/** The Overview is collapsed by default and the useful lines are often below the fold. */
async function expandOverview(page: Page): Promise<void> {
  for (const label of ["Show more", "Show all"]) {
    const button = page.getByRole("button", { name: label });
    if (await button.first().isVisible().catch(() => false)) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(1500);
      return;
    }
  }
}

/**
 * Find the Overview block.
 *
 * Google's class names are generated and rotate, so anchoring on them breaks
 * within weeks. The one stable thing on the page is the words "AI Overview", so
 * find that and climb to the ancestor that is actually a block of content.
 */
async function overviewBox(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const label = page.getByText("AI Overview", { exact: false }).first();
  if (!(await label.isVisible().catch(() => false))) return null;

  const box = await label.evaluate((node) => {
    let element = node as unknown as ClimbNode | null;
    // Climb until the container is wide enough to be the panel, not the label.
    for (let i = 0; i < 8 && element; i += 1) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 400 && rect.height > 200) {
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      element = element.parentElement;
    }
    return null;
  });
  return box;
}

/** Run one search and capture the Overview. */
export async function captureOverview(
  context: BrowserContext,
  query: string,
  options: BrowserOptions = {},
): Promise<OverviewCapture> {
  await mkdir(SHOT_DIR, { recursive: true });
  const page = await context.newPage();

  try {
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await acceptConsent(page);

    if (page.url().includes(BLOCK_MARKER)) {
      const cleared =
        options.headed && (await waitForHuman(page, options.unblockTimeoutSec ?? 180));
      if (!cleared) return { query, screenshotPath: null, text: null, sources: [], status: "blocked" };
      await page.waitForTimeout(1500);
    }

    // The Overview streams in after the rest of the page.
    await page
      .getByText("AI Overview", { exact: false })
      .first()
      .waitFor({ timeout: 12_000 })
      .catch(() => {});
    await expandOverview(page);
    await page.waitForTimeout(1200);

    const box = await overviewBox(page);
    if (!box) return { query, screenshotPath: null, text: null, sources: [], status: "no-overview" };

    const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const screenshotPath = join(SHOT_DIR, `${slug}.png`);
    await page.screenshot({
      path: screenshotPath,
      // Pad the clip: the citation chips sit just under the last line.
      clip: {
        x: Math.max(0, box.x - 8),
        y: Math.max(0, box.y - 8),
        width: Math.min(box.width + 16, 1400),
        height: Math.min(box.height + 40, 2200),
      },
    });

    const text = await page
      .getByText("AI Overview", { exact: false })
      .first()
      .evaluate((node) => {
        let element = node as unknown as ClimbNode | null;
        for (let i = 0; i < 8 && element; i += 1) {
          const rect = element.getBoundingClientRect();
          if (rect.width > 400 && rect.height > 200) return element.innerText;
          element = element.parentElement;
        }
        return null;
      })
      .catch(() => null);

    const sources = await page
      .locator("a[href^='http']:not([href*='google.com'])")
      .evaluateAll((links) =>
        [...new Set(links.slice(0, 40).map((a) => (a as unknown as { href: string }).href))],
      )
      .catch(() => [] as string[]);

    return { query, screenshotPath, text, sources: sources.slice(0, 12), status: "ok" };
  } finally {
    await page.close().catch(() => {});
  }
}
