/**
 * As-written phrasings for generated quotes. Every phrasing here is one Pharos's deterministic
 * normalisers accept (packages/domain normalise.ts / dates.ts), because generated quotes are
 * truth `extracted`. Each helper returns the text to print and the as-written span a perfect
 * transcriber would copy.
 */
import type { Port, Vessel } from "@pharos/shared";
import type { MoneySpan } from "../case.js";
import { type Prng, prngInt, prngPick } from "../prng.js";

export const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DAY_MS = 86_400_000;
const two = (n: number) => String(n).padStart(2, "0");

/** ISO day plus n days. */
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The UTC day of a Date as ISO. */
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

const partsOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() };
};

const ordinal = (n: number): string =>
  n % 100 >= 11 && n % 100 <= 13 ? `${n}th` : `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** Single-day styles accepted by parseQuoteDate. */
export const DAY_STYLES = [
  "d-mon-yyyy",
  "d-month-yyyy",
  "dd/mm/yyyy",
  "dd.mm.yy",
  "iso",
  "mon-d",
  "mon-d-yyyy",
  "d-mon",
  "d-month",
  "dd/mm",
  "wkd-d-month-yyyy",
  "wkd-d-mon",
  "dth-month",
] as const;
export type DayStyle = (typeof DAY_STYLES)[number];

export function formatDay(iso: string, style: DayStyle): string {
  const p = partsOf(iso);
  const mon = MONTH_SHORT[p.m];
  const month = MONTH_LONG[p.m];
  switch (style) {
    case "d-mon-yyyy":
      return `${p.d} ${mon} ${p.y}`;
    case "d-month-yyyy":
      return `${p.d} ${month} ${p.y}`;
    case "dd/mm/yyyy":
      return `${two(p.d)}/${two(p.m + 1)}/${p.y}`;
    case "dd.mm.yy":
      return `${two(p.d)}.${two(p.m + 1)}.${String(p.y).slice(2)}`;
    case "iso":
      return iso;
    case "mon-d":
      return `${mon} ${p.d}`;
    case "mon-d-yyyy":
      return `${mon} ${p.d}, ${p.y}`;
    case "d-mon":
      return `${p.d} ${mon}`;
    case "d-month":
      return `${p.d} ${month}`;
    case "dd/mm":
      return `${two(p.d)}/${two(p.m + 1)}`;
    case "wkd-d-month-yyyy":
      return `${WEEKDAY_LONG[p.dow]}, ${p.d} ${month} ${p.y}`;
    case "wkd-d-mon":
      return `${WEEKDAY_LONG[p.dow]?.slice(0, 3)} ${p.d} ${mon}`;
    case "dth-month":
      return `${ordinal(p.d)} ${month}`;
  }
}

/** Long human date for letterheads and quoted headers, e.g. "Friday, 13 November 2026". */
export const longDate = (iso: string): string => formatDay(iso, "wkd-d-month-yyyy");

/** Time-of-day suffixes the date parser strips. Never "20xx LT" (it would read as a year). */
const TIME_SUFFIXES = [
  " 17:00 LT",
  " 12:00 LT",
  " 18:00 UTC",
  " 1200 UTC",
  " 1700 LT",
  " noon LT",
  " at 16:00 LT",
] as const;

/** Validity as written: a day in some style, often with a time. */
export function phraseValidity(prng: Prng, iso: string): { text: string; style: DayStyle } {
  const style = prngPick(prng, DAY_STYLES);
  const day = formatDay(iso, style);
  if (prng() < 0.3) return { text: day, style };
  const suffix = prngPick(prng, TIME_SUFFIXES);
  const sep = style === "wkd-d-month-yyyy" && suffix === " noon LT" ? "," : "";
  return { text: `${day}${sep}${suffix}`, style };
}

export type WindowPhrase =
  | { kind: "one"; text: string; form: string }
  | { kind: "two"; from: string; to: string; form: string };

/** A delivery window as written, from ISO days (from < to, both in the same or next month). */
export function phraseWindow(prng: Prng, from: string, to: string): WindowPhrase {
  const a = partsOf(from);
  const b = partsOf(to);
  if (prng() < 0.2) {
    const withYear = prng() < 0.5;
    const style: DayStyle = prngPick(
      prng,
      withYear ? (["d-mon-yyyy", "dd/mm/yyyy", "iso"] as const) : (["d-mon", "mon-d"] as const),
    );
    return { kind: "two", from: formatDay(from, style), to: formatDay(to, style), form: "two" };
  }
  if (from >= to) throw new RangeError(`a delivery window needs from < to (${from}, ${to})`);
  const spanDays = (Date.parse(to) - Date.parse(from)) / DAY_MS;
  if (spanDays === 2 && prng() < 0.3) {
    return {
      kind: "one",
      text: `${formatDay(addDays(from, 1), "d-mon")} +/- 1 day`,
      form: "tolerance",
    };
  }
  const mon = MONTH_SHORT[b.m];
  const month = MONTH_LONG[b.m];
  const sameMonth = a.m === b.m;
  const forms: [string, string][] = [
    ["slash", `${two(a.d)}/${two(a.m + 1)}-${two(b.d)}/${two(b.m + 1)}`],
    ["mon-both", `${a.d} ${MONTH_SHORT[a.m]} - ${b.d} ${mon} ${b.y}`],
    ["dotted", `${two(a.d)}.${two(a.m + 1)}.${a.y} - ${two(b.d)}.${two(b.m + 1)}.${b.y}`],
  ];
  if (sameMonth) {
    forms.push(
      ["dash", `${a.d}-${b.d} ${mon}`],
      ["dash-long", `${a.d}-${b.d} ${month} ${b.y}`],
      ["mon-first", `${mon} ${a.d}-${b.d}`],
    );
  } else {
    forms.push(["cross-month", `${a.d} ${MONTH_SHORT[a.m]} - ${b.d} ${mon}`]);
  }
  const [form, text] = prngPick(prng, forms);
  return { kind: "one", text, form };
}

/** Number with optional thousands separator and decimals, as a supplier would print it. */
export function formatNumber(n: number, opts: { thousands: boolean; decimals: 0 | 2 }): string {
  const fixed = opts.decimals === 2 ? n.toFixed(2) : String(n);
  if (!Number.isInteger(n) && opts.decimals === 0) throw new Error(`${n} needs decimals`);
  const [int, frac] = fixed.split(".");
  const grouped = opts.thousands ? (int ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") : int;
  return frac === undefined ? `${grouped}` : `${grouped}.${frac}`;
}

/** How one quote writes all its prices and quantities (a supplier keeps one style per email). */
export interface AmountStyle {
  /** Index into the price forms (taken modulo their count). */
  priceForm: number;
  decimals: 0 | 2;
  unit: string;
}

const MASS_UNITS = ["mt", "mt", "MT", "mts", "MTS", "metric tons", "tonnes", "metric tonnes"];

export function pickAmountStyle(prng: Prng, prices: number[]): AmountStyle {
  return {
    priceForm: prngInt(prng, 0, 41),
    decimals: prices.every(Number.isInteger) ? prngPick(prng, [0, 0, 2] as const) : 2,
    unit: prngPick(prng, MASS_UNITS),
  };
}

/** A price per mt as written (USD or EUR), with its currency and per-unit strings. */
export function phrasePrice(
  prng: Prng,
  value: number,
  currency: "USD" | "EUR",
  style?: Pick<AmountStyle, "priceForm" | "decimals">,
): MoneySpan {
  const decimals: 0 | 2 =
    style?.decimals ?? (Number.isInteger(value) ? prngPick(prng, [0, 0, 2] as const) : 2);
  const n = formatNumber(value, { thousands: false, decimals });
  const usd: [string, string, string][] = [
    [`USD ${n} per mt`, "USD", "per mt"],
    [`USD ${n}/mt`, "USD", "/mt"],
    [`US$ ${n} pmt`, "US$", "pmt"],
    [`$${n}/mt`, "$", "/mt"],
    [`USD ${n} PMT`, "USD", "PMT"],
    [`${n} USD/MT`, "USD", "/MT"],
    [`USD ${n} per metric ton`, "USD", "per metric ton"],
  ];
  const eur: [string, string, string][] = [
    [`EUR ${n} per mt`, "EUR", "per mt"],
    [`€${n}/mt`, "€", "/mt"],
    [`€ ${n} pmt`, "€", "pmt"],
    [`EUR ${n}/MT`, "EUR", "/MT"],
    [`${n} EUR/mt`, "EUR", "/mt"],
    [`EUR ${n} per metric tonne`, "EUR", "per metric tonne"],
  ];
  const forms = currency === "USD" ? usd : eur;
  const form = style === undefined ? prngPick(prng, forms) : forms[style.priceForm % forms.length];
  if (!form) throw new Error("no price form");
  const [asWritten, cur, perUnit] = form;
  return { value, currency: cur, perUnit, asWritten };
}

/** A lump-sum barge fee as written. */
export function phraseBargeLump(prng: Prng, value: number, currency: "USD" | "EUR"): MoneySpan {
  const n = formatNumber(value, { thousands: prng() < 0.75, decimals: 0 });
  const forms: [string, string, string][] =
    currency === "USD"
      ? [
          [`USD ${n} lump sum`, "USD", "lump sum"],
          [`US$ ${n} lumpsum`, "US$", "lumpsum"],
          [`USD ${n} LS`, "USD", "LS"],
          [`$${n} lump sum`, "$", "lump sum"],
        ]
      : [
          [`EUR ${n} lump sum`, "EUR", "lump sum"],
          [`€${n} lump sum`, "€", "lump sum"],
          [`EUR ${n} lumpsum`, "EUR", "lumpsum"],
        ];
  const [asWritten, cur, perUnit] = prngPick(prng, forms);
  return { value, currency: cur, perUnit, asWritten };
}

/** "Included" phrasings for a barge fee that is not charged separately (truth 0). */
export const BARGE_INCLUDED = [
  "included in the price",
  "included",
  "delivery by barge included",
  "no separate charge",
] as const;

/** A quantity as written with its unit string. */
export function phraseQty(
  prng: Prng,
  qty: number,
  style?: Pick<AmountStyle, "unit">,
): { asWritten: string; unit: string } {
  const n = formatNumber(qty, { thousands: qty >= 1000 && prng() < 0.7, decimals: 0 });
  const unit = style?.unit ?? prngPick(prng, MASS_UNITS);
  return { asWritten: `${n} ${unit}`, unit };
}

/** Grade names the normaliser maps to exactly one grade. */
export const GRADE_NAMES = {
  LSMGO: ["LSMGO", "LSMGO 0.1%", "MGO 0.1%", "DMA 0.1%", "MGO", "LSMGO 0.10%S"],
  VLSFO: ["VLSFO", "VLSFO 0.5%", "VLSFO 0.50%", "0.5% VLSFO", "VLSFO 0.5% S"],
  HSFO: ["HSFO", "HSFO 3.5%", "IFO 380", "RMG 380", "IFO 380 3.5%S"],
} as const;

export function phraseGrade(prng: Prng, grade: keyof typeof GRADE_NAMES): string {
  return prngPick(prng, GRADE_NAMES[grade]);
}

export interface VesselPhrase {
  /** Printed after a "Vessel" label (or alone). */
  text: string;
  name: string | null;
  imo: string | null;
  form: "name-imo" | "name" | "imo";
}

/** The world name without its "MV "/"MT " prefix. */
export const bareName = (v: Vessel): string => v.name.replace(/^(?:MV|MT)\s+/, "");

export function phraseVessel(prng: Prng, v: Vessel): VesselPhrase {
  const bare = bareName(v);
  const prefix = v.name.slice(0, 2);
  const roll = prng();
  if (roll < 0.1) return { text: `IMO ${v.imo}`, name: null, imo: v.imo, form: "imo" };
  const name = prngPick(prng, [v.name, v.name, `${prefix.at(0)}/${prefix.at(1)} ${bare}`, bare]);
  const shown = prng() < 0.25 ? name.toUpperCase() : name;
  if (roll < 0.3) return { text: shown, name: shown, imo: null, form: "name" };
  const text = prngPick(prng, [
    `${shown} (IMO ${v.imo})`,
    `${shown} / IMO ${v.imo}`,
    `${shown}, IMO No. ${v.imo}`,
    `${shown} - IMO: ${v.imo}`,
  ]);
  return { text, name: shown, imo: v.imo, form: "name-imo" };
}

const COUNTRY: Record<string, string> = {
  EG: "Egypt",
  GR: "Greece",
  MT: "Malta",
  IT: "Italy",
  ES: "Spain",
  GI: "Gibraltar",
  PT: "Portugal",
  FR: "France",
  BE: "Belgium",
  NL: "Netherlands",
  DE: "Germany",
};

/** The port as printed and the value a transcriber copies (the port's own name). */
export function phrasePort(prng: Prng, p: Port): { text: string; value: string } {
  const country = COUNTRY[p.country] ?? p.country;
  const text = prngPick(prng, [
    p.name,
    p.name,
    `${p.name} anchorage`,
    p.name === country ? `${p.name} (${p.unlocode})` : `${p.name}, ${country}`,
    `${p.name} (${p.unlocode})`,
    `${p.name} outer anchorage`,
  ]);
  return { text, value: p.name };
}

const FIRST = [
  "Maria",
  "Nikos",
  "Elena",
  "Joost",
  "Anke",
  "Pedro",
  "Sofia",
  "Luca",
  "Hanna",
  "Tomás",
  "Claire",
  "Dimitris",
  "Inês",
  "Pieter",
  "Ahmed",
  "Laura",
];
const LAST = [
  "Vella",
  "Papadakis",
  "Borg",
  "de Vries",
  "Schulte",
  "Moreno",
  "Costa",
  "Ferraro",
  "Jansen",
  "Ribeiro",
  "Dubois",
  "Galea",
  "Kowalski",
  "Hassan",
  "Andersen",
  "Ruiz",
];

/** An ASCII-safe person for From display names and signatures. */
export function pickPerson(prng: Prng): { first: string; last: string; local: string } {
  const first = prngPick(prng, FIRST);
  const last = prngPick(prng, LAST);
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[^\p{L}\s]/gu, "")
      .replace(/\s+/g, "")
      .toLowerCase();
  return { first, last, local: `${fold(first)}.${fold(last)}` };
}

/** ASCII-only variant of a display name (headers must be ASCII). */
export const asciiName = (s: string): string => s.normalize("NFD").replace(/[^\x20-\x7e]/g, "");

/** A short reference code like "KMF-2611-0427". */
export function refCode(prng: Prng, prefix: string): string {
  return `${prefix}-2611-${String(prngInt(prng, 100, 9999)).padStart(4, "0")}`;
}

/** The supplier's three-letter code from its ERP code ("SUP-KES" -> "KES"). */
export const supplierCode = (erpCode: string): string => erpCode.replace(/^SUP-/, "");
