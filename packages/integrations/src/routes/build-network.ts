/** Builds the committed sea-route network from the Eurostat MARNET data in searoute-ts (data only). */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SeaNetwork } from "@pharos/shared";
import { DEFAULT_MARNET } from "searoute-ts";

export const NETWORK_PATH = fileURLToPath(new URL("./sea-network.generated.json", import.meta.url));

export const BBOX = { minLat: 28, maxLat: 62, minLon: -15, maxLon: 40 } as const;
export const NETWORK_SOURCE = "eurostat marnet 100km via searoute-ts@2.3.1";

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

export function buildSeaNetwork(): SeaNetwork {
  const segments: { lat: number; lon: number }[][] = [];
  for (const f of DEFAULT_MARNET.features) {
    if (f.geometry.type !== "LineString") continue;
    const pts = (f.geometry.coordinates as number[][]).map(([lon, lat]) => ({
      lat: round4(lat as number),
      lon: round4(lon as number),
    }));
    const inside = pts.some(
      (p) =>
        p.lat >= BBOX.minLat &&
        p.lat <= BBOX.maxLat &&
        p.lon >= BBOX.minLon &&
        p.lon <= BBOX.maxLon,
    );
    if (inside && pts.length >= 2) segments.push(pts);
  }
  segments.sort((a, b) => a[0]!.lat - b[0]!.lat || a[0]!.lon - b[0]!.lon);
  return SeaNetwork.parse({ source: NETWORK_SOURCE, bbox: { ...BBOX }, segments });
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
