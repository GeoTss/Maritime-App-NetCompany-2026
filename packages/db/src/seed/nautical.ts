/**
 * Charts and publications at their current editions, and the port-call seed: what each port offers
 * and charges, and what each fleet vessel carries. Editions come from the user's supplier
 * publications checklist and index (16 Nov 2026). Prices, coverage boxes, port terms and stores
 * are synthetic, illustrative planning values.
 */
import type { Box, NauticalItem, OnBoardItem, PortCallTerms, VesselStores } from "@pharos/shared";

const SOURCE = "Supplier publications checklist and index, 16 Nov 2026 (user-supplied)";
const CHART_USD = 45;
const PUBLICATION_USD = 150;

const box = (minLat: number, maxLat: number, minLon: number, maxLon: number): Box => ({
  minLat,
  maxLat,
  minLon,
  maxLon,
});

const chart = (
  itemId: string,
  title: string,
  editionDate: string,
  coverage: Box[],
): NauticalItem => ({
  itemId,
  kind: "chart",
  title,
  edition: editionDate.slice(0, 4),
  editionDate,
  priceUsd: CHART_USD,
  coverage,
  source: SOURCE,
});

const pub = (
  itemId: string,
  title: string,
  edition: string,
  year: number,
  coverage: Box[],
): NauticalItem => ({
  itemId,
  kind: "publication",
  title,
  edition,
  editionDate: `${year}-01-01`,
  priceUsd: PUBLICATION_USD,
  coverage,
  source: SOURCE,
});

/** Coverage boxes are drawn from each title's region and are illustrative, not chart limits. */
export const NAUTICAL_ITEMS: readonly NauticalItem[] = [
  chart("142", "Strait of Gibraltar", "2026-04-30", [box(35.7, 36.3, -6.1, -5.0)]),
  chart("773", "Strait of Gibraltar to Isla de Alboran", "2026-05-14", [
    box(35.6, 36.6, -5.4, -2.9),
  ]),
  pub("NP045", "Mediterranean Pilot Vol I", "18", 2024, [box(35, 42.5, -6, 4)]),
  pub("NP046", "Mediterranean Pilot Vol II", "18", 2022, [box(38, 44.5, 3, 12)]),
  pub("NP047", "Mediterranean Pilot Vol III", "18", 2024, [box(32, 40, 10, 19)]),
  pub("NP048", "Mediterranean Pilot Vol IV", "19", 2025, [box(36, 46, 12, 23)]),
  pub("NP049", "Mediterranean Pilot Vol V", "16", 2025, [box(30.5, 37.5, 19, 36.5)]),
  pub("NP078", "Admiralty List of Lights Vol E, West Mediterranean", "7", 2026, [
    box(30, 46, -6, 15),
  ]),
  pub("NP086", "Admiralty List of Lights Vol N, East Mediterranean and Black Sea", "7", 2026, [
    box(30, 47, 15, 42),
  ]),
  pub(
    "NP077",
    "Admiralty List of Lights Vol D, Eastern Atlantic, Western Indian Ocean, Arabian and Red Seas",
    "7",
    2026,
    [box(10, 44, -20, -5.6)],
  ),
  pub(
    "NP074",
    "Admiralty List of Lights Vol A, British Isles and North Coast of France",
    "7",
    2026,
    [box(48, 61, -11, 2)],
  ),
  pub(
    "NP075",
    "Admiralty List of Lights Vol B, Southern and Eastern Sides of the North Sea",
    "7",
    2026,
    [box(51, 61, 2, 9)],
  ),
  pub(
    "NP286(3)",
    "ALRS Pilot Services, VTS and Port Operations: Mediterranean, Black Sea and Suez Canal",
    "7",
    2026,
    [box(30, 47, -6, 42)],
  ),
  pub(
    "NP286(1)",
    "ALRS Pilot Services, VTS and Port Operations: United Kingdom and Europe",
    "7",
    2026,
    [box(36, 44, -15, -5.6), box(44, 62, -15, 10)],
  ),
  pub("NP067", "West Coast of Spain and Portugal Pilot", "15", 2024, [box(36, 43.8, -10.5, -6)]),
  pub("NP022", "Bay of Biscay Pilot", "15", 2024, [box(43.3, 48.5, -10, -1)]),
  pub("NP027", "Channel Pilot", "14", 2023, [box(48.4, 51, -6, 1.5)]),
  pub("NP028", "Dover Strait Pilot", "14", 2024, [box(50.5, 51.6, 0.5, 3)]),
  pub("NP055", "North Sea (East) Pilot", "14", 2026, [box(51.3, 56, 3, 9)]),
  // Track 3 (Suez transits): required when transiting the canal; the current routes never enter it.
  pub("OTH318", "Rules of Navigation, Suez Canal", "Dec 2020", 2020, [box(29.9, 31.2, 32.2, 32.7)]),
];

const terms = (over: Partial<PortCallTerms> & { euWasteFeeUsd: number }): PortCallTerms => ({
  portDuesUsd: 3500,
  clearanceHours: 2,
  stores: true,
  provisionsUsdPerPersonDay: 12,
  storesHours: 4,
  wasteReception: true,
  sludgeUsdPerM3: 200,
  sewageUsdPerM3: 70,
  wasteHours: 3,
  ...over,
});

/** The demo bunker ports' terms; every other port gets `defaultCallTerms`. */
const DEMO_PORT_TERMS: Readonly<Record<string, PortCallTerms>> = {
  MTMLA: terms({
    portDuesUsd: 3200,
    clearanceHours: 2,
    provisionsUsdPerPersonDay: 12,
    sludgeUsdPerM3: 180,
    sewageUsdPerM3: 60,
    euWasteFeeUsd: 950,
  }),
  ESALG: terms({
    portDuesUsd: 4100,
    clearanceHours: 3,
    provisionsUsdPerPersonDay: 11,
    euWasteFeeUsd: 1100,
  }),
  GIGIB: terms({
    portDuesUsd: 2400,
    clearanceHours: 1,
    provisionsUsdPerPersonDay: 13,
    storesHours: 3,
    sludgeUsdPerM3: 240,
    sewageUsdPerM3: 80,
    euWasteFeeUsd: 0,
  }),
  GRPIR: terms({
    portDuesUsd: 3800,
    clearanceHours: 3,
    provisionsUsdPerPersonDay: 11,
    sludgeUsdPerM3: 170,
    sewageUsdPerM3: 60,
    euWasteFeeUsd: 1000,
  }),
  PTSIE: terms({
    portDuesUsd: 3000,
    stores: false,
    provisionsUsdPerPersonDay: 0,
    storesHours: 0,
    sludgeUsdPerM3: 190,
    euWasteFeeUsd: 900,
  }),
};

export function portCallTermsFor(unlocode: string, isEu: boolean): PortCallTerms {
  return DEMO_PORT_TERMS[unlocode] ?? terms({ euWasteFeeUsd: isEu ? 1000 : 0 });
}

const current: OnBoardItem[] = NAUTICAL_ITEMS.map((i) => ({
  itemId: i.itemId,
  edition: i.edition,
  editionDate: i.editionDate,
}));

/** Aegean Pioneer's out-of-date items (the rest are at their current editions). */
const AEGEAN_STALE: readonly OnBoardItem[] = [
  { itemId: "142", edition: "2023", editionDate: "2023-06-01" },
  { itemId: "773", edition: "2024", editionDate: "2024-02-15" },
  { itemId: "NP078", edition: "6", editionDate: "2025-01-01" },
  { itemId: "NP022", edition: "14", editionDate: "2019-01-01" },
];

const onBoard = (stale: readonly OnBoardItem[]): OnBoardItem[] =>
  current.map((c) => stale.find((s) => s.itemId === c.itemId) ?? { ...c });

const stores = (
  crew: number,
  provisionsDays: number,
  sludgeM3: number,
  sewageM3: number,
  stale: readonly OnBoardItem[] = [],
): VesselStores => ({
  crew,
  provisionsPersonDays: crew * provisionsDays,
  sludgeM3,
  sludgeCapacityM3: 14,
  sewageM3,
  sewageCapacityM3: 15,
  onBoard: onBoard(stale),
});

/** Fixed per vessel: crew, days of provisions, sludge and sewage m³ (tanks 14 and 15 m³). */
const VESSEL_STORES: Readonly<Record<string, VesselStores>> = {
  "MV Aegean Pioneer": stores(22, 12, 11.8, 6, AEGEAN_STALE),
  "MV Thessaly Star": stores(21, 48, 6.2, 5.1),
  "MV Nordic Lantern": stores(20, 52, 4.4, 7.8),
  "MV Iberian Dawn": stores(23, 41, 8.1, 4.6),
  "MV Coral Horizon": stores(22, 55, 5.0, 8.9),
  "MV Scheldt Express": stores(20, 44, 7.3, 6.0),
};

export function vesselStoresFor(name: string): VesselStores | null {
  return VESSEL_STORES[name] ?? null;
}
