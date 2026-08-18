/**
 * Reflow a plain-text email body so it renders correctly in a proportional-font
 * client (Gmail etc.), where the composer's older monospace assumptions break.
 *
 * Two problems it fixes, both visible on a phone:
 *  1. Hard-wrapped prose — lines broken at ~65 chars turn into ragged
 *     mid-sentence wraps. We drop the baked-in breaks and let the client wrap,
 *     keeping one sentence per line so nothing splits mid-word.
 *  2. Arrow/column result blocks — `service   ->   rivals` padded so the arrows
 *     line up. Proportional spaces aren't equal width, so the columns shatter.
 *     We drop the arrow entirely and rewrite each entry as `Service: rivals`,
 *     one per line with a blank line between, so nothing depends on alignment.
 *
 * It is deliberately conservative: a body that already reads correctly (single
 * line per paragraph, unpadded block) passes through unchanged.
 */
export function reflowBody(body: string): string {
  return body
    .split(/\n\s*\n/)
    .map((para, idx, all) => {
      const lines = para.split("\n");

      // Result block: any paragraph containing an arrow line. Re-group so a
      // wrapped continuation rejoins its entry, then rewrite `service -> rivals`
      // as `Service: rivals`, blank-line separated. No arrows, no padding.
      if (lines.some((l) => l.includes("->"))) {
        const entries: string[] = [];
        for (const l of lines) {
          if (l.includes("->")) entries.push(l);
          else if (entries.length) entries[entries.length - 1] += " " + l;
          else entries.push(l);
        }
        return entries
          .map((e) => {
            const flat = e.replace(/\s+/g, " ").trim();
            const m = flat.match(/^(.*?)\s*->\s*(.*)$/);
            if (!m) return flat;
            const svc = m[1]!.trim();
            return `${svc.charAt(0).toUpperCase()}${svc.slice(1)}: ${m[2]!.trim()}`;
          })
          .join("\n\n");
      }

      // Signature (last paragraph): leave its line breaks alone.
      if (idx === all.length - 1) return lines.map((l) => l.trim()).join("\n");

      // Prose: join wrapped lines, ending an output line only at real sentence
      // punctuation. Short standalone lines (market figures, the CTA) each end
      // in punctuation already, so they stay on their own lines.
      const out: string[] = [];
      let cur = "";
      for (const l of lines) {
        const t = l.trim();
        if (!t) continue;
        cur = cur ? cur + " " + t : t;
        if (/[.?:!]$/.test(t)) {
          out.push(cur);
          cur = "";
        }
      }
      if (cur) out.push(cur);
      return out.join("\n");
    })
    .join("\n\n");
}
