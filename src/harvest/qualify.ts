import type { HarvestQuery } from "./query-matrix.js";
import type { SerperPlace } from "./serper.js";

/**
 * National chains. They have in-house marketing, no local decision maker, and
 * never buy from cold email — filtering them costs nothing and saves sends.
 */
const CHAINS = [
  "ideal image",
  "sono bello",
  "european wax",
  "aspen dental",
  "smile direct",
  "h&r block",
  "jackson hewitt",
];

/** A business good enough to spend a send on. */
export interface Prospect {
  placeId: string;
  name: string;
  category: string;
  city: string;
  country: string;
  clusterId: string;
  website: string;
  domain: string;
  phone: string;
  rating: number;
  reviewCount: number;
  status: "new";
}

export const QUALIFIERS = {
  /** Review count is the revenue proxy — too few means too small to afford us. */
  minReviewCount: 15,
  /** Below this they have a reputation problem, not a visibility problem. */
  minRating: 4.0,
} as const;

/**
 * Deterministic filter, not an LLM. `/places` already returns clean structured
 * fields; parsing them with a model is the most common waste in these
 * workflows and adds drift for nothing.
 */
export function qualify(places: SerperPlace[], source: HarvestQuery): Prospect[] {
  const out: Prospect[] = [];

  for (const place of places) {
    if (!place.website) continue;
    if ((place.ratingCount ?? 0) < QUALIFIERS.minReviewCount) continue;
    if ((place.rating ?? 0) < QUALIFIERS.minRating) continue;

    const title = place.title ?? "";
    if (CHAINS.some((chain) => title.toLowerCase().includes(chain))) continue;

    const domain = domainOf(place.website);
    if (!domain) continue; // unparseable URL — skip rather than guess

    out.push({
      placeId: String(place.cid ?? `${title}-${place.address ?? ""}`),
      name: title,
      category: place.category ?? source.service,
      city: source.city,
      country: source.country,
      clusterId: source.clusterId,
      website: place.website,
      domain,
      phone: place.phoneNumber ?? "",
      rating: place.rating ?? 0,
      reviewCount: place.ratingCount ?? 0,
      status: "new",
    });
  }

  return out;
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Same business can surface under several service+city queries. */
export function dedupeByDomain(prospects: Prospect[]): Prospect[] {
  const seen = new Set<string>();
  return prospects.filter((p) => !seen.has(p.domain) && seen.add(p.domain));
}
