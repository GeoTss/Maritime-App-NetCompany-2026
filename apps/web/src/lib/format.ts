/**
 * Display formatting: thousands grouping and a fixed number of decimals per unit. This is the only
 * arithmetic the console does (rounding for display); it never derives one value from another.
 */

const LOCALE = "en-GB";

/** Units written before the number ("USD 233,914.00"). */
const CURRENCY_UNITS = new Set(["USD", "EUR", "usd", "eur"]);
/** Units written straight after the number, without a space ("12.5%"). */
const TIGHT_UNITS = new Set(["%"]);

const DECIMALS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  usd: 2,
  eur: 2,
  "USD/mt": 2,
  "EUR/mt": 2,
  "/mt": 2,
  per_mt: 2,
  "USD/EUR": 4,
  mt: 1,
  "mt/day": 1,
  "t CO₂": 1,
  kn: 1,
  nm: 0,
  h: 1,
  day: 1,
  days: 1,
  "%": 1,
  m: 1,
  // Sludge and sewage are a few m³: one decimal.
  m3: 1,
};

/** How a unit is written when it differs from its code. */
const UNIT_TEXT: Record<string, string> = { m3: "m³" };

/** Decimals shown for a value in this unit. Unknown units: whole numbers as is, else 2. */
export function displayDecimals(unit: string | null, value: number): number {
  const known = unit === null ? undefined : DECIMALS[unit];
  if (known !== undefined) return known;
  return Number.isInteger(value) ? 0 : 2;
}

/** The `Intl.NumberFormat` options behind `formatNumber`, shared with `MetricNumber`. */
export interface DisplayFormat {
  minimumFractionDigits: number;
  maximumFractionDigits: number;
  useGrouping: true;
}

export function numberFormatOptions(unit: string | null, value: number): DisplayFormat {
  const d = displayDecimals(unit, value);
  return { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: true };
}

/** How the unit sits around the digits. */
export function unitAffixes(unit: string | null): { prefix: string; suffix: string } {
  if (!unit) return { prefix: "", suffix: "" };
  if (CURRENCY_UNITS.has(unit)) return { prefix: `${unit.toUpperCase()} `, suffix: "" };
  if (TIGHT_UNITS.has(unit)) return { prefix: "", suffix: unit };
  return { prefix: "", suffix: ` ${UNIT_TEXT[unit] ?? unit}` };
}

const formatters = new Map<string, Intl.NumberFormat>();
function formatterFor(options: DisplayFormat): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, options);
    formatters.set(key, f);
  }
  return f;
}

/** The digits alone, grouped and rounded for display. */
export function formatDigits(value: number, unit: string | null): string {
  if (!Number.isFinite(value)) return "—";
  return formatterFor(numberFormatOptions(unit, value)).format(value);
}

/** "USD 233,914.00", "612.50 USD/mt", "14.2 kn", "12.5%". A non-finite value is a dash. */
export function formatNumber(value: number, unit: string | null): string {
  if (!Number.isFinite(value)) return "—";
  const { prefix, suffix } = unitAffixes(unit);
  return `${prefix}${formatDigits(value, unit)}${suffix}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO-8601 instant with a time and a zone, e.g. "2026-11-26T15:01:46.466Z". */
export const ISO_INSTANT_SOURCE = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})`;
const ISO_INSTANT = new RegExp(`^${ISO_INSTANT_SOURCE}$`);

/** Whether a value is an ISO instant (shown as `formatUtc`, the full value in the source). */
export const isIsoInstant = (value: unknown): value is string =>
  typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));

/** "14 Nov 08:05Z": an instant in UTC, as the desk reads times. */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

/** "14 Nov": the UTC day of an instant. */
export function formatUtcDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "08:05Z": the time of day in UTC. */
export function formatUtcTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

/** "2026-11-14 08:05:00Z": a full timestamp for provenance (AIS position time, model run). */
export function formatUtcFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

/** "Nordwind Bunker Services'": the possessive of a name, with no second s after an s. */
export const possessive = (name: string): string => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
