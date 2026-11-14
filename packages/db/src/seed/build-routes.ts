/**
 * Builds routes.generated.json from the real Eurostat 2025 maritime network (searoute-ts).
 * The only module that imports searoute-ts; generateWorld reads the committed JSON offline.
 * Run: npm run db:routes -w @pharos/db
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ecaDistanceKm, NoRouteError, seaRoute } from "searoute-ts";
import { lookupPort } from "searoute-ts/ports";
import "searoute-ts/eca";
import { LEGS, PORTS } from "./scenario.js";
import type { RoutesFile } from "./types.js";

const KM_PER_NM = 1.852;
const r1 = (n: number): number => Math.round(n * 10) / 10;
const r4 = (n: number): number => Math.round(n * 10_000) / 10_000;

function portCoord(locode: string): { lat: number; lon: number } {
  const p = lookupPort(locode);
  if (!p) throw new Error(`port ${locode} missing from searoute-ts/ports`);
  return { lat: r4(p.coordinates[1]), lon: r4(p.coordinates[0]) };
}

export function buildRoutes(): RoutesFile {
  const ports = Object.fromEntries(
    [...PORTS]
      .map((p) => p.unlocode)
      .sort()
      .map((c) => [c, portCoord(c)]),
  );
  const legs = [...LEGS]
    .map(([from, to]) => {
      const a = ports[from];
      const b = ports[to];
      if (!a || !b) throw new Error(`leg ${from}-${to} uses an unknown port`);
      try {
        const route = seaRoute(from, to, { units: "nauticalmiles", emissions: true });
        const props = route.properties as {
          length: number;
          originSnapKm: number;
          destinationSnapKm: number;
          ecaFraction?: number;
        };
        if (route.geometry.type !== "LineString")
          throw new Error(`${from}-${to}: not a LineString`);
        const inner = (route.geometry.coordinates as number[][]).map(([lon, lat]) => ({
          lat: r4(lat ?? 0),
          lon: r4(lon ?? 0),
        }));
        return {
          from,
          to,
          source: "searoute" as const,
          waypoints: [a, ...inner, b],
          ecaFraction: r4(props.ecaFraction ?? 0),
          libraryLengthNm: r1(props.length),
          originSnapNm: r1(props.originSnapKm / KM_PER_NM),
          destinationSnapNm: r1(props.destinationSnapKm / KM_PER_NM),
        };
      } catch (err) {
        // Ports closer than the network resolution (Gibraltar <-> Algeciras, across the bay)
        // snap to the same vertex: use the direct port-to-port line.
        if (!(err instanceof NoRouteError)) throw err;
        const line = [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ];
        return {
          from,
          to,
          source: "direct" as const,
          waypoints: [a, b],
          ecaFraction: ecaDistanceKm(line) > 0 ? 1 : 0,
          libraryLengthNm: 0,
          originSnapNm: 0,
          destinationSnapNm: 0,
        };
      }
    })
    .sort((x, y) => `${x.from}-${x.to}`.localeCompare(`${y.from}-${y.to}`));
  return { network: "eurostat-2025 via searoute-ts@2.3.1", ports, legs };
}

export const ROUTES_FILE = fileURLToPath(new URL("./routes.generated.json", import.meta.url));

export function serializeRoutes(file: RoutesFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(ROUTES_FILE, serializeRoutes(buildRoutes()));
  console.log(`wrote ${ROUTES_FILE}`);
}
