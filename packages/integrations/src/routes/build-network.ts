/** Builds the committed sea-route network from the Eurostat MARNET data in searoute-ts (data only). */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SeaNetwork } from "@pharos/shared";
import { DEFAULT_MARNET } from "searoute-ts";

export const NETWORK_PATH = fileURLToPath(new URL("./sea-network.generated.json", import.meta.url));

/** Europe and the Mediterranean: the original region. Its segments come first, in their old order. */
export const CORE_BBOX = { minLat: 28, maxLat: 62, minLon: -15, maxLon: 40 } as const;
/**
 * The whole network: adds the Red Sea, the Gulf of Aden, the Arabian Sea and the Gulf of Oman, East
 * Africa down to the Cape, and West Africa with the Gulf of Guinea (Track 3: security).
 */
export const BBOX = { minLat: -40, maxLat: 62, minLon: -25, maxLon: 72 } as const;
export const NETWORK_SOURCE = "eurostat marnet 100km via searoute-ts@2.3.1";

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

type Box = { minLat: number; maxLat: number; minLon: number; maxLon: number };
const touches = (pts: { lat: number; lon: number }[], b: Box): boolean =>
  pts.some((p) => p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon);
const byStart = (a: { lat: number; lon: number }[], b: { lat: number; lon: number }[]) =>
  a[0]!.lat - b[0]!.lat || a[0]!.lon - b[0]!.lon;

/**
 * The segments that touch `BBOX`. Those touching the original `CORE_BBOX` come first, sorted as
 * they always were, so the graph's existing nodes keep their indices (and every route inside
 * Europe and the Mediterranean its tie-breaks); the new region's segments follow, sorted the same way.
 */
export function buildSeaNetwork(): SeaNetwork {
  const core: { lat: number; lon: number }[][] = [];
  const added: { lat: number; lon: number }[][] = [];
  for (const f of DEFAULT_MARNET.features) {
    if (f.geometry.type !== "LineString") continue;
    const pts = (f.geometry.coordinates as number[][]).map(([lon, lat]) => ({
      lat: round4(lat as number),
      lon: round4(lon as number),
    }));
    if (pts.length < 2) continue;
    if (touches(pts, CORE_BBOX)) core.push(pts);
    else if (touches(pts, BBOX)) added.push(pts);
  }
  core.sort(byStart);
  added.sort(byStart);
  return SeaNetwork.parse({
    source: NETWORK_SOURCE,
    bbox: { ...BBOX },
    segments: [...core, ...added],
  });
}

export const serialiseNetwork = (n: SeaNetwork): string => `${JSON.stringify(n)}\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = serialiseNetwork(buildSeaNetwork());
  if (process.argv.includes("--check")) {
    let committed = "";
    try {
      committed = readFileSync(NETWORK_PATH, "utf8");
    } catch {
      /* missing counts as different */
    }
    if (committed !== text) {
      console.error("sea-network.generated.json is out of date; run npm run routes:network");
      process.exit(1);
    }
    console.log("sea network is up to date");
  } else {
    writeFileSync(NETWORK_PATH, text);
    console.log(`wrote ${NETWORK_PATH}`);
  }
}
