import { requireEnv } from "../env.js";
import type { HarvestQuery } from "./query-matrix.js";

/** The subset of a Serper `/places` result we actually use. */
export interface SerperPlace {
  title?: string;
  address?: string;
  website?: string;
  phoneNumber?: string;
  rating?: number;
  ratingCount?: number;
  category?: string;
  /** Google's stable place identifier. */
  cid?: string | number;
}

const ENDPOINT = "https://google.serper.dev/places";

export class SerperError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Serper returned ${status}: ${body.slice(0, 200)}`);
    this.name = "SerperError";
  }
}

/**
 * One Serper call = one credit. `buildQueries()` produces ~105 of them, so a
 * full harvest run costs ~105 credits — check your plan before scheduling it
 * daily.
 */
export async function searchPlaces(query: HarvestQuery): Promise<SerperPlace[]> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "X-API-KEY": requireEnv("SERPER_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query.query, gl: query.gl, hl: "en" }),
  });

  if (!response.ok) throw new SerperError(response.status, await response.text());

  const data = (await response.json()) as { places?: SerperPlace[] };
  return data.places ?? [];
}

/** The subset of a Serper `/search` organic result we read. */
export interface SerperOrganic {
  title?: string;
  link?: string;
  snippet?: string;
}

export interface SerperWebResult {
  organic: SerperOrganic[];
  /** Google's knowledge panel, when the query has one. Shape varies; passed through. */
  knowledgeGraph?: Record<string, unknown>;
}

const SEARCH_ENDPOINT = "https://google.serper.dev/search";

/** Plain Google search. Also one credit per call. */
export async function searchWeb(q: string, gl = "us"): Promise<SerperWebResult> {
  const response = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "X-API-KEY": requireEnv("SERPER_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q, gl, hl: "en" }),
  });

  if (!response.ok) throw new SerperError(response.status, await response.text());

  const data = (await response.json()) as {
    organic?: SerperOrganic[];
    knowledgeGraph?: Record<string, unknown>;
  };
  return { organic: data.organic ?? [], knowledgeGraph: data.knowledgeGraph };
}
