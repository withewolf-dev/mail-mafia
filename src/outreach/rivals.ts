/**
 * Keep our own prospects out of the competitor lines.
 *
 * The probes answer honestly, and the honest answer often names the business
 * two rows down our own list: probing Born Again Doctor for PRP hair
 * restoration returned "Ocala Plastic Surgery & Dermatology (Aqua Med Spa)" and
 * "Vitality Medicine", which are prospects #3 and #9. Mailing that line tells
 * one prospect their neighbour is beating them while we pitch the neighbour the
 * same week — and the two of them are four miles apart in The Villages.
 *
 * The skeleton has said "never a name that is also in your prospect list" since
 * it was written. Nothing enforced it until this ran for real.
 */

/**
 * Normalise for comparison: lowercase, no punctuation, no corporate suffixes.
 *
 * Parenthetical content is kept, not stripped — it is usually the part that
 * identifies the business. The probe wrote "Ocala Plastic Surgery & Dermatology
 * (Aqua Med Spa)", and "Aqua Med Spa" is the only thing in that string tying it
 * to our own row.
 */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(llc|inc|pa|pllc|pc|ltd|co|the|and)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Words too generic to identify a business.
 *
 * Two groups: what everyone in this vertical calls themselves, and the towns
 * they are all in. Both would otherwise match everything against everything —
 * every prospect here is a "med spa" and half are in "The Villages".
 */
const GENERIC = new Set([
  "med", "medical", "spa", "aesthetics", "aesthetic", "clinic", "center", "centre",
  "health", "wellness", "beauty", "skin", "care", "surgery", "dermatology",
  "institute", "studio", "day", "laser", "medicine", "of", "location", "the",
  // Towns in the harvest area.
  "ocala", "villages", "wildwood", "summerfield", "belleview", "lady", "lake",
  "florida", "gainesville", "leesburg", "clermont",
]);

const distinctive = (name: string): string[] =>
  normaliseName(name).split(" ").filter((w) => w.length > 2 && !GENERIC.has(w));

/**
 * Is this competitor one of ours?
 *
 * Matches on distinctive words rather than the whole string, because the probe
 * writes names its own way — "Ocala Plastic Surgery & Dermatology (Aqua Med
 * Spa)" has to match the row stored as "Aqua Med Spa: The Villages Location".
 * Generic words are excluded from that test, or every med spa would match every
 * other one.
 */
export function isOwnProspect(competitor: string, prospectNameKeys: string[]): boolean {
  const words = distinctive(competitor);
  if (!words.length) return false;

  return prospectNameKeys.some((key) => {
    const ours = distinctive(key);
    if (!ours.length) return false;
    // One shared distinctive word is enough once the vertical's vocabulary and
    // the local place names are excluded: what remains is the actual brand
    // ("aqua", "vitality", "floriderm"), and two unrelated businesses sharing
    // one of those is not a thing that happens in one county.
    return ours.some((w) => words.includes(w));
  });
}

/** Drop our own prospects from a competitor list, preserving order. */
export function stripOwnProspects(
  competitors: string[],
  prospectNameKeys: string[],
): { kept: string[]; removed: string[] } {
  const kept: string[] = [];
  const removed: string[] = [];
  for (const competitor of competitors) {
    (isOwnProspect(competitor, prospectNameKeys) ? removed : kept).push(competitor);
  }
  return { kept, removed };
}
