/**
 * Search Google in a real browser, screenshot the AI Overview, read it with
 * Claude, and store what it claims against the prospect.
 *
 *   npx tsx src/cli/ai-overview.ts --headed              # first run: clear the bot check by hand
 *   npx tsx src/cli/ai-overview.ts --redo 4              # one prospect
 *   npx tsx src/cli/ai-overview.ts --cdp 9222            # drive your own logged-in Chrome
 *   npx tsx src/cli/ai-overview.ts --dry                 # capture and print, store nothing
 *
 * To use --cdp, quit Chrome and start it with:
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *
 * One query per prospect: "<domain> owner". Captures upsert on (prospect_id,
 * query), so a rerun replaces its previous capture instead of stacking a copy.
 *
 * This finds the NAME only. It never writes owner_email — an Overview quotes
 * whatever address a page happens to print, which is usually a shared inbox,
 * and a shared inbox is not the owner's email. The address comes from the FL
 * DOH registry via find-owner, or the field stays null.
 */
import "../env.js";
import { db } from "../db/client.js";
import { captureOverview, openBrowser } from "../outreach/browser.js";
import { readOverview, type OverviewFacts } from "../outreach/overview.js";
import { lookupPractitioner } from "../outreach/doh.js";
import { NAME_CONFIDENCE_FLOOR } from "../outreach/owner.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const headed = args.includes("--headed");
const cdpArg = args.indexOf("--cdp");
const cdpPort = cdpArg >= 0 ? Number(args[cdpArg + 1]) : undefined;
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 5;
const redoArg = args.indexOf("--redo");
const redoIds =
  redoArg >= 0 ? args.slice(redoArg + 1).filter((a) => /^\d+$/.test(a)).map(Number) : [];

interface Row {
  id: number;
  name: string;
  domain: string | null;
  city: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  owner_email: string | null;
}

const rows = (
  redoIds.length
    ? await db()`
        select id, name, domain, city, owner_first_name, owner_last_name, owner_email
        from prospects where id = any(${redoIds}::bigint[]) order by id`
    : await db()`
        select id, name, domain, city, owner_first_name, owner_last_name, owner_email
        from prospects
        where owner_found_at is null and status <> 'excluded'
        order by id limit ${limit}`
) as unknown as Row[];

if (!rows.length) {
  console.log("No prospects matched.");
  process.exit(0);
}

// One browser for the whole run: a fresh profile per search is exactly the
// pattern that trips the bot check.
const context = await openBrowser({ cdpPort, headed });
let blocked = false;

/**
 * Hosts that belong to a platform rather than a prospect. A Google Maps export
 * puts whatever is in the listing's website field into prospects.domain, and
 * for a business with no site of its own that is often its Facebook page.
 */
const SHARED_HOSTS =
  /^(www\.)?(facebook|instagram|linkedin|twitter|x|yelp|google|business\.site|linktr\.ee|wixsite|squarespace|godaddysites)\.[a-z.]+$/i;

/** Ten searches back-to-back is what re-trips the check. Space them out. */
const pause = (): Promise<void> =>
  new Promise((done) => setTimeout(done, 4_000 + Math.floor(Math.random() * 5_000)));

async function store(row: Row, capture: Awaited<ReturnType<typeof captureOverview>>, facts: OverviewFacts | null) {
  if (dry) return;
  await db()`
    insert into ai_overviews
      (prospect_id, query, status, screenshot_path, overview_text,
       owner_first_name, owner_last_name, owner_role, email,
       other_people, cited_sources, confidence)
    values (${row.id}, ${capture.query}, ${capture.status}, ${capture.screenshotPath},
            ${facts?.verbatim ?? capture.text}, ${facts?.ownerFirstName ?? null},
            ${facts?.ownerLastName ?? null}, ${facts?.ownerRole ?? null}, ${facts?.email ?? null},
            ${facts?.otherPeople.join("; ") ?? null}, ${facts?.citedSources.join("; ") ?? null},
            ${facts?.confidence ?? null})
    on conflict (prospect_id, query) do update set
      status = excluded.status, screenshot_path = excluded.screenshot_path,
      overview_text = excluded.overview_text, owner_first_name = excluded.owner_first_name,
      owner_last_name = excluded.owner_last_name, owner_role = excluded.owner_role,
      email = excluded.email, other_people = excluded.other_people,
      cited_sources = excluded.cited_sources, confidence = excluded.confidence,
      captured_at = now()
  `;
}

/**
 * Overview gives the name; the FL DOH registry gives the address.
 *
 * Neither half substitutes for the other. A name below the confidence floor is
 * discarded rather than stored — it would become the greeting on a cold email
 * to a stranger — and an address is only ever the one the practitioner filed
 * with the state. Anything else stays null.
 */
async function promote(row: Row, query: string, facts: OverviewFacts): Promise<void> {
  const notes: string[] = [
    `query: ${query}`,
    `AI Overview: ${facts.ownerRole ?? "role not stated"} (confidence ${facts.confidence.toFixed(2)})`,
    facts.citedSources.length ? `cites: ${facts.citedSources.join(", ")}` : "cites: none shown",
    facts.verbatim,
    ...facts.otherPeople.map((p) => `also named: ${p}`),
  ];

  const named = Boolean(facts.ownerFirstName && facts.ownerLastName);
  const confident = facts.confidence >= NAME_CONFIDENCE_FLOOR;
  let first: string | null = null;
  let last: string | null = null;
  let email: string | null = null;

  if (named && confident) {
    first = facts.ownerFirstName;
    last = facts.ownerLastName;

    const record = await lookupPractitioner(first!, last!, row.city ?? undefined);
    if (!record) {
      notes.push(`No FL DOH licence found for ${first} ${last} — owner_email left null.`);
    } else {
      const detail = [record.profession, record.city, record.status].filter(Boolean).join(", ");
      notes.push(`FL DOH licence ${record.license}${detail ? ` (${detail})` : ""} - ${record.detailUrl}`);
      if (record.email) {
        email = record.email;
        notes.push(`Email on file with FL DOH: ${record.email}`);
      } else {
        notes.push(`No email on file with FL DOH for ${record.license} — owner_email left null.`);
      }
    }
  } else if (named) {
    notes.push(
      `Name discarded: "${facts.ownerFirstName} ${facts.ownerLastName}" at confidence ` +
        `${facts.confidence.toFixed(2)}, below the ${NAME_CONFIDENCE_FLOOR} floor.`,
    );
  } else {
    notes.push("No owner named in the Overview.");
  }

  await db()`
    update prospects set
      owner_first_name = ${first},
      owner_last_name  = ${last},
      owner_email      = ${email},
      owner_notes      = ${notes.join("\n")},
      owner_found_at   = now(),
      updated_at       = now()
    where id = ${row.id}`;

  console.log(
    `     -> stored: ${first ?? "null"} ${last ?? ""} | ${email ?? "no email"}`.replace(/\s+\|/, " |"),
  );
}

try {
  for (const row of rows) {
    console.log(`\n#${row.id}  ${row.name}`);

    const owner = [row.owner_first_name, row.owner_last_name].filter(Boolean).join(" ");
    // One owner query, keyed on prospects.domain exactly as stored —
    // "nuwaworld.com", not a stripped root and not the Maps listing name. The
    // domain resolves to exactly one entity, so it survives a listing named for
    // a satellite ("Aqua Med Spa: The Villages Location") and it cannot collide
    // the way a bare brand name does: "NUWA WORLD owner" can return an
    // unrelated company's founder.
    // ...unless the "domain" is a platform every business shares. A Maps
    // listing whose website field points at a Facebook page stores
    // facebook.com here, and "facebook.com owner" returns Mark Zuckerberg.
    // Those hosts identify the platform, not the prospect.
    const usable = row.domain && !SHARED_HOSTS.test(row.domain) ? row.domain : row.name;
    if (row.domain && usable === row.name) {
      console.log(`  (domain ${row.domain} is a shared platform — searching by name instead)`);
    }
    const queries = [`${usable} owner`];

    for (const [index, query] of queries.entries()) {
      if (index > 0 || row !== rows[0]) await pause();
      const capture = await captureOverview(context, query, {
        headed,
        unblockTimeoutSec: 240,
      });

      if (capture.status !== "ok") {
        console.log(`  "${query}" -> ${capture.status}`);
        if (capture.status === "blocked") blocked = true;
        await store(row, capture, null);
        if (blocked) break;
        continue;
      }

      const facts = await readOverview(capture);
      const named = [facts.ownerFirstName, facts.ownerLastName].filter(Boolean).join(" ");
      console.log(`  "${query}" -> shot: ${capture.screenshotPath}`);
      console.log(
        `     owner: ${named || "(none stated)"}${facts.ownerRole ? ` — ${facts.ownerRole}` : ""}` +
          `   email: ${facts.email ?? "(none shown)"}   confidence: ${facts.confidence.toFixed(2)}`,
      );
      if (facts.otherPeople.length) console.log(`     also named: ${facts.otherPeople.join("; ")}`);
      if (facts.citedSources.length) console.log(`     cites: ${facts.citedSources.join(", ")}`);

      await store(row, capture, facts);
      if (!dry) await promote(row, capture.query, facts);

    }

    if (blocked) {
      console.log("\nStopped: Google is blocking this browser. Re-run with --headed and clear the");
      console.log("check by hand, or use --cdp against your own signed-in Chrome.");
      break;
    }
  }
} finally {
  await context.close().catch(() => {});
}
