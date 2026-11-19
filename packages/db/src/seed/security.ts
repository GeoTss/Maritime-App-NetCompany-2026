/**
 * Track 3 seed: the danger areas (levels, policies and boundaries from the cited sources in
 * docs/research/2026-11-19-maritime-security-sources.md), the fictional security providers, hull
 * values and the Suez Canal terms. Boxes approximate the published limits; rates are illustrative
 * unless a source is named.
 */
import type { Box, CanalTerms, SecurityArea } from "@pharos/shared";

const box = (minLat: number, maxLat: number, minLon: number, maxLon: number): Box => ({
  minLat,
  maxLat,
  minLon,
  maxLon,
});

const PALAEMON =
  "Maritime Security Report 2nd–9th November 2026, Palaemon Maritime, 9 Nov 2026 (citing JMIC; secondary), https://palaemonmaritime.com/post/maritime-security-report-2nd-9th-november-2026";
const JWLA =
  "JWLA-035 JWC Listed Areas, LMA/IUA Joint War Committee, 16 Sep 2026, https://lmalloyds.com/wp-content/uploads/2026/09/JWLA-035-Black-Sea.pdf";

/** Ranked most-needed first (the order the console lists them in). */
export const SECURITY_AREAS: readonly SecurityArea[] = [
  {
    id: "strait-of-hormuz",
    name: "Strait of Hormuz",
    level: "SEVERE",
    policy: "avoid",
    boxes: [box(25.8, 27.0, 55.5, 57.0)],
    asOf: "2026-11-08",
    source: PALAEMON,
    note: "US/Israel–Iran conflict since 28 Feb 2026, blockade enforcement; JMIC counts 177 confirmed incidents since 1 Mar.",
  },
  {
    id: "gulf-of-aden",
    name: "Gulf of Aden",
    level: "SUBSTANTIAL",
    policy: "guards",
    // East of the Bab-el-Mandeb strait (about 43.4°E) to the Arabian Sea.
    boxes: [box(10.8, 15.0, 43.6, 51.5)],
    asOf: "2026-11-09",
    source: PALAEMON,
    note: "Houthi campaign against Saudi-linked shipping since 20 Jul 2026, and the Somali piracy route.",
  },
  {
    id: "southern-red-sea",
    name: "Southern Red Sea and Bab-el-Mandeb",
    level: "SUBSTANTIAL",
    policy: "premium",
    boxes: [box(12.0, 25.5, 32.3, 43.5)],
    asOf: "2026-11-09",
    source: `${PALAEMON}; JWC limit "Red Sea, south of Latitude 25.5°N": ${JWLA}`,
    note: "Missile and drone attacks, which armed guards cannot stop: the risk is priced through the war-risk premium (0.5 % of hull value for a Bab-el-Mandeb transit, Jul 2026).",
  },
  {
    id: "arabian-sea-somali-basin",
    name: "Arabian Sea and Somali Basin",
    level: "MODERATE",
    policy: "guards",
    // The Somali Basin south of the Gulf of Aden, and the Arabian Sea east of it, to 65°E.
    boxes: [box(-6.75, 11.0, 41.5, 65.0), box(11.0, 16.0, 51.5, 65.0)],
    asOf: "2026-11-16",
    source:
      "Maritime piracy incidents remain at historic lows despite Somali piracy concerns, ICC, 15 Oct 2026, https://iccwbo.org/news-publications/news/maritime-piracy-incidents-remain-at-historic-lows-despite-somali-piracy-concerns/; Armed Skiff Approaches Tanker Far Out in Arabian Sea, gCaptain, 16 Nov 2026",
    note: "8 Somali hijackings Jan–Sep 2026; an armed skiff with a ladder approached a tanker about 430 nm east of Socotra on 16 Nov. JWC southern limit 6°45'S.",
  },
  {
    id: "gulf-of-oman",
    name: "Gulf of Oman",
    level: "MODERATE",
    policy: "measures",
    boxes: [box(22.5, 25.8, 56.3, 61.5)],
    asOf: "2026-11-08",
    source: PALAEMON,
    note: "Attacks on ships after 1 Oct 2026; report to UKMTO and keep protective measures.",
  },
  {
    id: "gulf-of-guinea",
    name: "Gulf of Guinea",
    level: "LISTED",
    policy: "escort",
    boxes: [box(-0.67, 6.11, 1.2, 8.7)],
    asOf: "2026-10-15",
    source: `${JWLA}; ICC/IMB, 15 Oct 2026`,
    note: "Listed by insurers; 2 incidents Jan–Sep 2026. Private armed guards are not allowed in Nigerian waters: navy escort vessels instead.",
  },
];

/** Fictional security providers (the demo's quote emails come from these). */
export const SECURITY_PROVIDERS = [
  {
    name: "Tridentis Marine Protection",
    emailDomain: "tridentis-marine.example",
    erpCode: "SEC-TRI",
  },
  { name: "Aegis Watch Maritime", emailDomain: "aegiswatch.example", erpCode: "SEC-AEG" },
  {
    name: "Harbourline Security Services",
    emailDomain: "harbourline-security.example",
    erpCode: "SEC-HBL",
  },
] as const;

/** Hull value (USD) per vessel, for the war-risk premium. Illustrative. */
export const HULL_VALUE_USD: Readonly<Record<string, number>> = {
  "MT Atlantic Meridian": 45_000_000,
};

/**
 * The Suez Canal: its box, dues and the daily northbound convoy. Dues are illustrative (no
 * authoritative dollar toll was found; the 37 % laden-crude surcharge of Jul 2026 is noted in the
 * research); the convoy leaves 05:30–11:00 and transits in 12–16 h (Kuehne+Nagel, Sep 2024).
 */
export const SUEZ_CANAL: CanalTerms = {
  id: "suez",
  box: box(29.85, 31.3, 32.2, 32.65),
  duesUsd: 300_000,
  convoyHourUtc: 5.5,
  transitHours: 14,
};
