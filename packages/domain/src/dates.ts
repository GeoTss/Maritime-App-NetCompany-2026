/**
 * Pure date helpers for quote emails: as-written dates and delivery windows to ISO days,
 * and the barge-fee total. Day granularity, computed in UTC. The `reference` Date is the
 * only time input (no clock). Unparseable text returns null, never throws.
 */

/** Window after which an undated-year date is read as next year (days before the reference). */
const YEAR_ROLLOVER_GRACE_DAYS = 60;

const MS_PER_DAY = 86_400_000;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

type Parts = { d: number; m: number | null; y: number | null };

const pad = (n: number, w: number): string => String(n).padStart(w, "0");

const toIso = (ms: number): string => {
  const t = new Date(ms);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1, 2)}-${pad(t.getUTCDate(), 2)}`;
};

/** UTC midnight of a real calendar day, or null (31/02, month 13, ...). */
function dayMs(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, m - 1, d);
  const t = new Date(ms);
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? ms : null;
}

const refDayMs = (reference: Date): number =>
  Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());

const fullYear = (raw: string): number => (raw.length === 2 ? 2000 + Number(raw) : Number(raw));

const fold = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, " ");

const WEEKDAY_PREFIX = /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/;
// A trailing time, with or without a zone: "12:00", "12:00 utc", "noon lt". A bare "1200" needs a zone word.
const TIME_SUFFIX =
  /[\s,]+(?:at\s+)?(?:(?:noon|\d{1,2}:\d{2}(?::\d{2})?)(?:\s*(?:lt|lmt|utc|gmt|z))?|\d{3,4}\s*(?:lt|lmt|utc|gmt|z))$/;

/** Split an as-written date into day, optional month and optional explicit year. */
function parseParts(raw: string, allowBareDay: boolean): Parts | null {
  let s = fold(raw);
  s = s.replace(WEEKDAY_PREFIX, "").replace(TIME_SUFFIX, "").trim();
  if (s === "") return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };

  // Numeric dates are day/month (maritime convention).
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/.exec(s);
  if (m) return { d: Number(m[1]), m: Number(m[2]), y: m[3] ? fullYear(m[3]) : null };

  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]*([a-z]{3,9})\.?(?:,?\s*(\d{4}|\d{2}))?$/.exec(s);
  if (m) {
    const month = MONTHS[m[2] as string];
    if (month === undefined) return null;
    return { d: Number(m[1]), m: month, y: m[3] ? fullYear(m[3]) : null };
  }

  m = /^([a-z]{3,9})\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}|\d{2}))?$/.exec(s);
  if (m) {
    const month = MONTHS[m[1] as string];
    if (month === undefined) return null;
    return { d: Number(m[2]), m: month, y: m[3] ? fullYear(m[3]) : null };
  }

  if (allowBareDay) {
    m = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(s);
    if (m) return { d: Number(m[1]), m: null, y: null };
  }
  return null;
}

/** Year for a date written without one: reference year, or next when > 60 days before the reference. */
function resolveMissingYear(m: number, d: number, reference: Date): number | null {
  const ref = refDayMs(reference);
  const y = reference.getUTCFullYear();
  const here = dayMs(y, m, d);
  if (here === null) return null;
  return ref - here > YEAR_ROLLOVER_GRACE_DAYS * MS_PER_DAY ? y + 1 : y;
}

function resolveParts(p: Parts, reference: Date): number | null {
  if (p.m === null) return null;
  const y = p.y ?? resolveMissingYear(p.m, p.d, reference);
  return y === null ? null : dayMs(y, p.m, p.d);
}

/**
 * As-written quote date to ISO `YYYY-MM-DD`. Numeric dates are day/month. A missing year takes
 * the reference year, or the next year when that would be more than 60 days before the reference.
 */
export function parseQuoteDate(asWritten: string | null, reference: Date): string | null {
  if (asWritten === null) return null;
  const parts = parseParts(asWritten, false);
  if (parts === null) return null;
  const ms = resolveParts(parts, reference);
  return ms === null ? null : toIso(ms);
}

const RANGE_SEPARATOR = /\s*(?:-|–|—|\bto\b|\buntil\b)\s*/g;

function parseRange(s: string, reference: Date): { from: number; to: number } | null {
  for (const sep of s.matchAll(RANGE_SEPARATOR)) {
    const left = parseParts(s.slice(0, sep.index), true);
    const right = parseParts(s.slice(sep.index + sep[0].length), false);
    if (left === null || right === null || right.m === null) continue;

    const to = resolveParts(right, reference);
    if (to === null) continue;
    let from: number | null;
    if (left.m === null || left.y === null) {
      const month = left.m ?? right.m;
      if (left.y !== null) {
        from = dayMs(left.y, month, left.d);
      } else if (left.m === null || right.y !== null) {
        // Year (and month) written only on the second part: share it, stepping back a year when
        // that would put the start after the end ("30 Dec - 2 Jan 2027"; not for a bare day).
        const y = new Date(to).getUTCFullYear();
        from = dayMs(y, month, left.d);
        if (left.m !== null && from !== null && from > to) from = dayMs(y - 1, month, left.d);
      } else {
        from = resolveParts({ d: left.d, m: month, y: null }, reference);
      }
    } else {
      from = resolveParts(left, reference);
    }
    if (from === null) continue;
    return { from, to };
  }
  return null;
}

/**
 * As-written delivery window to ISO days. Accepts a range ("18-19 Nov", "18/11-19/11"), a single
 * date (from = to) and a tolerance ("ETA 18 Nov +/- 1 day"). Null when unreadable or to < from.
 */
export function parseDeliveryWindow(
  asWritten: string | null,
  reference: Date,
): { from: string; to: string } | null {
  if (asWritten === null) return null;
  const s = fold(asWritten).replace(/^(?:on|eta|etd|by|around|approx\.?|from)\s+/, "");
  if (s === "") return null;

  const tol = /^(.*?)\s*(?:\+\/-|\+-|±)\s*(\d+)\s*days?$/.exec(s);
  if (tol) {
    const base = parseParts(tol[1] as string, false);
    const centre = base === null ? null : resolveParts(base, reference);
    if (centre === null) return null;
    const n = Number(tol[2]);
    return { from: toIso(centre - n * MS_PER_DAY), to: toIso(centre + n * MS_PER_DAY) };
  }

  const single = parseParts(s, false);
  if (single !== null) {
    const ms = resolveParts(single, reference);
    return ms === null ? null : { from: toIso(ms), to: toIso(ms) };
  }

  const range = parseRange(s, reference);
  if (range === null || range.to < range.from) return null;
  return { from: toIso(range.from), to: toIso(range.to) };
}

/** Barge fee in the quote currency: fee x quantity for per-mt, the fee itself for a lump sum. */
export function bargeFeeTotal(fee: number, perUnit: "per_mt" | "lump_sum", qtyMt: number): number {
  return perUnit === "per_mt" ? fee * qtyMt : fee;
}
