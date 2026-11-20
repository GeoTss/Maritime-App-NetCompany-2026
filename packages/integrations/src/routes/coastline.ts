import { readFileSync } from "node:fs";
import type { LatLon } from "@pharos/shared";
import { z } from "zod";

/** Written by `npm run map:basemap` from the same Natural Earth rings as the map's land. */
const CoastlineFile = z.object({
  source: z.string().min(1),
  rings: z.array(z.array(z.tuple([z.number(), z.number()])).min(2)),
});

let cached: LatLon[][] | undefined;

/** The committed coastline rings as lat/lon, parsed once per process. */
export function loadCoastline(): LatLon[][] {
  cached ??= CoastlineFile.parse(
    JSON.parse(
      readFileSync(new URL("./coastline.generated.json", import.meta.url), "utf8"),
    ) as unknown,
  ).rings.map((ring) => ring.map(([lon, lat]) => ({ lat, lon })));
  return cached;
}
