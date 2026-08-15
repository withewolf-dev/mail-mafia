/**
 * The ICP, as a cross product of services and cities.
 *
 * Hardcoded on purpose: you already know who you sell to. The original
 * workflow had Claude "research niches" every morning, which cost latency and
 * spend to return the same answer, and drifted.
 */
export interface MarketBlock {
  /** Serper country code. */
  gl: string;
  country: string;
  services: string[];
  cities: string[];
}

export const MATRIX: MarketBlock[] = [
  {
    gl: "ae",
    country: "UAE",
    services: [
      "company formation",
      "business setup consultants",
      "PRO services",
      "med spa",
      "aesthetic clinic",
      "hair transplant clinic",
      "cosmetic dentist",
    ],
    cities: [
      "Dubai",
      "Business Bay Dubai",
      "DIFC Dubai",
      "JLT Dubai",
      "Al Barsha Dubai",
      "Abu Dhabi",
      "Sharjah",
    ],
  },
  {
    gl: "us",
    country: "US",
    services: [
      "med spa",
      "aesthetic clinic",
      "cosmetic dentist",
      "plastic surgeon",
      "immigration attorney",
      "estate planning attorney",
      "CPA firm",
    ],
    cities: [
      "Scottsdale AZ",
      "Austin TX",
      "Dallas TX",
      "Miami FL",
      "Atlanta GA",
      "Nashville TN",
      "Denver CO",
      "Newport Beach CA",
    ],
  },
];

export interface HarvestQuery {
  query: string;
  service: string;
  city: string;
  gl: string;
  country: string;
  /** Groups prospects that came from the same service+city search. */
  clusterId: string;
}

/** One Serper call per query returned here — mind the credit cost. */
export function buildQueries(matrix: MarketBlock[] = MATRIX): HarvestQuery[] {
  const out: HarvestQuery[] = [];
  for (const block of matrix) {
    for (const service of block.services) {
      for (const city of block.cities) {
        out.push({
          query: `${service} in ${city}`,
          service,
          city,
          gl: block.gl,
          country: block.country,
          clusterId: `${service}|${city}`.toLowerCase().replace(/\s+/g, "-"),
        });
      }
    }
  }
  return out;
}
