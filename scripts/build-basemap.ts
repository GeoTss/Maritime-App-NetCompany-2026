/**
 * Builds the console's offline basemap: Natural Earth 1:50m land (public domain) from the
 * `world-atlas` package, clipped to the demo region and written as GeoJSON. Run at build time
 * only (`npm run map:basemap`); the app fetches it from its own origin (apps/web/public), never from the network.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

const BBOX = { minLon: -20, maxLon: 45, minLat: 25, maxLat: 66 } as const;
const OUT = new URL("../apps/web/public/basemap.generated.geojson", import.meta.url);

const require = createRequire(import.meta.url);
const topo = JSON.parse(
  readFileSync(require.resolve("world-atlas/land-50m.json"), "utf8"),
) as Topology;
const land = feature(topo, topo.objects.land as GeometryCollection);

type Ring = [number, number][];
const inBox = ([lon, lat]: [number, number]) =>
  lon >= BBOX.minLon - 5 &&
  lon <= BBOX.maxLon + 5 &&
  lat >= BBOX.minLat - 5 &&
  lat <= BBOX.maxLat + 5;
const round = (v: number) => Math.round(v * 1e2) / 1e2;

/** Rounds to 0.01° and drops consecutive duplicate points (a closed ring stays closed). */
function simplifyRing(ring: Ring): Ring {
  const out: Ring = [];
  for (const [lon, lat] of ring) {
    const p: [number, number] = [round(lon), round(lat)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

const polygons: Ring[][] = [];
for (const f of land.features) {
  const g = f.geometry;
  const polys =
    g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  for (const poly of polys as Ring[][]) {
    if (!poly[0]?.some(inBox)) continue;
    const rings = poly.map(simplifyRing).filter((ring) => ring.length >= 4);
    if (rings.length > 0) polygons.push(rings);
  }
}

const out = {
  type: "FeatureCollection",
  source: "Natural Earth 1:50m land via world-atlas@2.0.2 (public domain)",
  bbox: [BBOX.minLon, BBOX.minLat, BBOX.maxLon, BBOX.maxLat],
  features: [
    { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: polygons } },
  ],
};
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`map:basemap: ${polygons.length} land polygons written to ${OUT.pathname}`);
