import { parse } from "csv-parse/sync";
import { domainOf } from "../harvest/qualify.js";

/**
 * A row destined for `prospects`. Both CSV shapes normalise into this.
 */
export interface ProspectRow {
  placeId: string | null;
  name: string;
  nameKey: string;
  website: string | null;
  domain: string | null;
  email: string | null;
  emailVerified: boolean | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  rating: number | null;
  reviewCount: number | null;
  sourceFile: string | null;
}

export type CsvShape = "google-maps" | "emails" | "unknown";

/**
 * Header sets vary between exports — the Maps files even swap Rating and
 * Reviews Count between runs — so everything maps by header name, never by
 * column position.
 */
export function detectShape(headers: string[]): CsvShape {
  const h = headers.map((x) => x.trim().toLowerCase());
  if (h.includes("google maps url") || (h.includes("name") && h.includes("website"))) {
    return "google-maps";
  }
  if (h.includes("email") && h.includes("company")) return "emails";
  return "unknown";
}

/**
 * Strip case, punctuation and legal suffixes so "Orchidia Medical Group, LLC"
 * and "Orchidia Medical Group" match when joining the two files.
 */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(llc|l\.l\.c|inc|incorporated|ltd|limited|corp|corporation|co|pllc|pc|pa|dds|md)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Maps URLs carry the id as `?q=place_id:ChIJ...`. */
export function placeIdFrom(mapsUrl: string): string | null {
  return mapsUrl.match(/place_id:([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

/**
 * "6204 Hixson Pike, Hixson, TN 37343, USA" -> city "Hixson", region "TN".
 * Heuristic: US exports put city second-from-the-state segment. Returns nulls
 * rather than guessing when the shape doesn't match.
 */
export function splitAddress(address: string): { city: string | null; region: string | null } {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return { city: null, region: null };
  const stateZip = parts[parts.length - 2] ?? "";
  const region = stateZip.match(/^([A-Z]{2})\b/)?.[1] ?? null;
  const city = region ? (parts[parts.length - 3] ?? null) : null;
  return { city, region };
}

const clean = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

const num = (v: unknown): number | null => {
  const s = clean(v);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function parseCsv(content: string): Record<string, string>[] {
  return parse(content, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[];
}

export function toRows(records: Record<string, string>[], sourceFile: string): ProspectRow[] {
  const rows: ProspectRow[] = [];

  for (const r of records) {
    // Case-insensitive header lookup, since exports vary in casing too.
    const get = (key: string): string | null => {
      const found = Object.keys(r).find((k) => k.trim().toLowerCase() === key);
      return found ? clean(r[found]) : null;
    };

    const name = get("name") ?? get("company");
    if (!name) continue; // a row with no business name is unusable

    const website = get("website");
    const address = get("address");
    const { city, region } = address ? splitAddress(address) : { city: null, region: null };
    const mapsUrl = get("google maps url");
    const verifiedRaw = get("email_verified");

    rows.push({
      placeId: mapsUrl ? placeIdFrom(mapsUrl) : null,
      name,
      nameKey: nameKey(name),
      website,
      domain: website ? domainOf(website) : null,
      email: get("email")?.toLowerCase() ?? null,
      emailVerified: verifiedRaw === null ? null : verifiedRaw.toLowerCase() === "yes",
      phone: get("phone"),
      address,
      city,
      region,
      rating: num(get("rating")),
      reviewCount: num(get("reviews count")),
      sourceFile,
    });
  }

  return rows;
}
