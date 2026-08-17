import { db } from "../db/client.js";
import type { SiteStatus } from "./crawl.js";
import type { SourcePage } from "./crawl.js";

/**
 * Plain-language notes about what happened when we tried to read a site.
 *
 * The existing `draft_error` says "site unreachable or empty" for a parked
 * domain, a Cloudflare block and a timeout alike — three problems with three
 * different answers. A remark keeps the distinction, so a batch can skip the
 * dead ones for good and retry the rest.
 */
export function remarkFor(status: SiteStatus, pages: SourcePage[]): string {
  const chars = pages.reduce((sum, p) => sum + p.text.length, 0);

  switch (status) {
    case "parked":
      return "parked: registrar lander, no site to read";
    case "unreachable":
      return "unreachable: no usable response";
    case "empty":
      return "empty: responds, but serves no content";
    case "ok":
      return pages.length === 0
        ? "ok but nothing rendered: site responded, crawler returned no pages"
        : `ok: ${pages.length} page(s), ${chars.toLocaleString()} chars`;
  }
}

/**
 * Write the remark against the prospect with this domain. Silent when there is
 * no matching row — the crawler is also run on URLs that aren't prospects yet.
 */
export async function recordRemark(domain: string, remark: string): Promise<number> {
  const q = db();
  const rows = (await q`
    update prospects
       set scraping_remarks = ${remark}, updated_at = now()
     where domain = ${domain.replace(/^www\./, "").toLowerCase()}
    returning id`) as { id: string }[];
  return rows.length;
}
