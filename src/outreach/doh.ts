/**
 * Florida DOH practitioner registry — the licence file behind the AI answer.
 *
 * Every practitioner licensed in Florida files a contact email with the
 * Division of Medical Quality Assurance, and the portal publishes it. Google's
 * AI Overview gives up Dr. Hassanein's floripathol@aol.com because it read this
 * page; so can we, for two plain HTTP requests and no credits.
 *
 * Worth trying before any paid search: the ICP is local high-ticket practices,
 * and their owners are almost always licensed practitioners.
 *
 * Florida only. A prospect outside FL needs that state's own registry, which is
 * a different portal with a different form each time.
 */
const BASE = "https://mqa-internet.doh.state.fl.us/MQASearchServices/HealthCareProviders";

const TIMEOUT_MS = 20_000;

export interface DohRecord {
  license: string;
  /** As filed: "HASSANEIN, ASHRAF M". */
  name: string;
  profession: string;
  city: string;
  /** "Clear/Active", "Null And Void", "Delinquent", … */
  status: string;
  email: string | null;
  detailUrl: string;
}

interface ResultRow {
  license: string;
  name: string;
  profession: string;
  city: string;
  status: string;
  licInd: string;
  proCde: string;
}

const stripTags = (html: string): string =>
  html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** The portal is ASP.NET MVC: the search POST needs the form's antiforgery token and its cookie. */
async function openSession(): Promise<{ token: string; cookie: string }> {
  const response = await fetch(BASE, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const html = await response.text();
  const token = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1];
  if (!token) throw new Error("DOH search page returned no antiforgery token");
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  return { token, cookie };
}

function parseRows(html: string): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const match of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const row = match[1]!;
    // The portal is inconsistent about the parameter's case — ProCde in links,
    // Procde in the single-result redirect.
    const link = row.match(/href="([^"]*LicInd=(\d+)&(?:amp;)?ProCde=(\d+))"/i);
    if (!link) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[1]!));
    if (cells.length < 5) continue;
    rows.push({
      license: cells[0]!,
      name: cells[1]!,
      profession: cells[2]!,
      city: cells[3]!,
      status: cells[4]!,
      licInd: link[2]!,
      proCde: link[3]!,
    });
  }
  return rows;
}

/**
 * Pick the row that is actually this person, or nothing.
 *
 * Returning nothing matters more than returning a best guess. "James Rogers"
 * matches 30 Florida licences — an EMT in Lake Butler, a CNA, a respiratory
 * therapist — and picking the liveliest one puts a stranger's personal address
 * in the send list under the name of a plastic surgeon. A common name with no
 * corroborating city is not a match, it is an ambiguity.
 *
 * A single result is safe: the registry holds one Nasirul Huq. Beyond that,
 * only a city match discriminates, and an active licence breaks the remaining
 * tie — a void one carries an address abandoned years ago.
 */
function pickBest(rows: ResultRow[], city?: string): ResultRow | undefined {
  const liveliest = (candidates: ResultRow[]): ResultRow | undefined =>
    [...candidates].sort(
      (a, b) => Number(/clear|active/i.test(b.status)) - Number(/clear|active/i.test(a.status)),
    )[0];

  if (rows.length === 1) return rows[0];

  const wanted = city?.trim().toUpperCase();
  if (!wanted) return undefined;
  const inCity = rows.filter((row) => row.city.toUpperCase().includes(wanted));
  return inCity.length ? liveliest(inCity) : undefined;
}

/** The filed email, when the practitioner published one. */
async function readEmail(licInd: string, proCde: string): Promise<string | null> {
  const response = await fetch(`${BASE}/Details?LicInd=${licInd}&ProCde=${proCde}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const text = stripTags(await response.text());
  // The page reads "Email Address Please contact at: someone@example.com".
  // Anchor on that label — a bare address regex also catches the portal's own
  // webmaster and privacy-notice addresses in the footer.
  const labelled = text.match(/Email Address[^:]*:?\s*([\w.%+-]+@[\w.-]+\.[a-z]{2,})/i);
  return labelled?.[1]?.toLowerCase() ?? null;
}

/** Read one field out of the licence page's flattened text. */
const field = (text: string, label: RegExp): string =>
  text.match(label)?.[1]?.trim() ?? "";

/**
 * Assemble the record. `row` carries the results-table values when we came via
 * the table; the single-result redirect has none, so those are read off the
 * licence page instead.
 */
async function buildRecord(
  licInd: string,
  proCde: string,
  pageHtml?: string,
  row?: ResultRow,
): Promise<DohRecord> {
  const detailUrl = `${BASE}/Details?LicInd=${licInd}&ProCde=${proCde}`;
  const text = pageHtml ? stripTags(pageHtml) : "";
  return {
    license: row?.license ?? field(text, /Licen[cs]e Number:?\s*([A-Z]+\d+)/i),
    name: row?.name ?? field(text, /Licensee Name:?\s*([A-Za-z ,.'-]+?)\s{2,}/),
    profession: row?.profession ?? field(text, /Profession:?\s*([A-Za-z ]+?)(?:\s{2,}|$)/),
    city: row?.city ?? "",
    status: row?.status ?? field(text, /Licen[cs]e Status:?\s*([A-Za-z\/ ]+?)(?:\s{2,}|$)/i),
    email: await readEmail(licInd, proCde),
    detailUrl,
  };
}

/**
 * Look a practitioner up by name. Returns null when the registry has nobody,
 * or when the lookup fails — a state portal being down should never sink the
 * enrichment run.
 */
export async function lookupPractitioner(
  firstName: string,
  lastName: string,
  city?: string,
): Promise<DohRecord | null> {
  try {
    const { token, cookie } = await openSession();
    const response = await fetch(BASE, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({
        __RequestVerificationToken: token,
        "SearchDto.FirstName": firstName,
        "SearchDto.LastName": lastName,
        "SearchDto.Board": "",
        "SearchDto.Profession": "",
        "SearchDto.LicenseNumber": "",
        "SearchDto.BusinessName": "",
        "SearchDto.City": "",
        "SearchDto.County": "",
        "SearchDto.ZipCode": "",
        "SearchDto.LicenseStatus": "",
      }),
    });
    if (!response.ok) return null;
    const html = await response.text();

    // Exactly one match skips the results table and redirects straight to the
    // licence page, so there are no rows to parse. This is the common case for
    // an uncommon name — and it was silently reading as "not found".
    const direct = response.url.match(/LicInd=(\d+)&(?:amp;)?ProCde=(\d+)/i);
    if (direct) return await buildRecord(direct[1]!, direct[2]!, html);

    const best = pickBest(parseRows(html), city);
    if (!best) return null;
    return await buildRecord(best.licInd, best.proCde, undefined, best);
  } catch {
    return null;
  }
}
