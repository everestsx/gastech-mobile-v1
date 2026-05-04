/**
 * Normalize licence plate strings to warehouse stock.complete_name keys like "0417/Stock".
 * Hyphen-split (not `.pop()` on the whole plate) avoids LN-0417-1 → "1"/Stock mismatches that
 * uniquely hurt vehicles whose code is ambiguous with a short trailing suffix (reported LN-0417).
 */

/**
 * @param {string} licensePlate e.g. "LN-0417", "LX-0423-extra"
 * @returns {string[]} ordered digit codes to try against Odoo `{code}/Stock`
 */
export function deriveWarehouseDigitRunsFromPlate(licensePlate) {
  const trimmed = String(licensePlate || '').trim();
  if (!trimmed) return [];

  /** Each hyphen/underscore slice: LN-0417-1 → [0417], not [1]. */
  const hyphenChunks = trimmed.split(/[-_/]/).map((s) => s.trim()).filter(Boolean);
  const fromHyphen = hyphenChunks.map((chunk) => chunk.replace(/\D/g, '')).filter((d) => d.length >= 3);

  const wordRuns = [];
  const reWord = /\b(\d{3,6})\b/g;
  let m;
  while ((m = reWord.exec(trimmed)) !== null) {
    wordRuns.push(m[1]);
  }

  const allDigits = trimmed.replace(/\D/g, '');
  const fromTail =
    !fromHyphen.length && /^[A-Za-z]+\d+$/.test(trimmed.replace(/\s/g, '')) && allDigits.length >= 4
      ? [allDigits.slice(Math.max(0, allDigits.length - 5)), allDigits.slice(-4)].filter((d) => d.length >= 3)
      : [];

  /** Prefer hyphen-derived (vehicle code sits after fleet prefix); then standalone words; then tail heuristic. */
  const baseRuns = [...new Set([...fromHyphen, ...wordRuns, ...fromTail])];

  /** Expand leading-zero SKU (0417 → also try 417 if Odoo code differs). Prefer longer/original first. */
  const out = [];
  const seen = new Set();
  const pushUnique = (d) => {
    if (!d || seen.has(d)) return;
    seen.add(d);
    out.push(d);
  };

  for (const run of baseRuns) {
    pushUnique(run);
    const stripped = run.replace(/^0+/, '') || '0';
    if (stripped !== run && stripped.length >= 2) pushUnique(stripped);
  }

  if (!out.length && allDigits.length >= 3) {
    pushUnique(allDigits);
  }

  return out;
}
