/**
 * Basemap geometry for `build-basemap.ts`. Natural Earth draws Eurasia as one ring that crosses
 * the antimeridian round Chukotka: in plain lon/lat it has two edges that jump 360°, which the
 * map's tiler turns into a band across the world and wrong fills (Iberia drew inverted at map zoom
 * 2.5–4). Splitting such a polygon at ±180° removes the jumps and keeps every continent.
 */

/** [lon, lat] pairs; a closed ring repeats its first point last. */
export type Ring = [number, number][];

const jumps = (ring: Ring) =>
  ring.some((p, i) => i > 0 && Math.abs(p[0] - (ring[i - 1] as [number, number])[0]) > 180);

/** The ring made continuous: ∓360 added after each jump of more than 180° in longitude. */
function unwrap(ring: Ring): Ring {
  const out: Ring = [];
  let offset = 0;
  for (const [i, [lon, lat]] of ring.entries()) {
    if (i > 0) {
      const d = lon - (ring[i - 1] as [number, number])[0];
      if (d > 180) offset -= 360;
      else if (d < -180) offset += 360;
    }
    out.push([lon + offset, lat]);
  }
  return out;
}

/** One Sutherland–Hodgman pass against a vertical line; the ring is open (no repeated last point). */
function clipLon(ring: Ring, x: number, keep: (lon: number) => boolean): Ring {
  const out: Ring = [];
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length] as [number, number];
    const inA = keep(a[0]);
    const inB = keep(b[0]);
    if (inA) out.push(a);
    if (inA !== inB) out.push([x, a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0])]);
  }
  return out;
}

/** The closed ring clipped to −180 ≤ lon ≤ 180, closed again; null when fewer than 3 points remain. */
function clipToWorld(ring: Ring): Ring | null {
  let open = ring.slice(0, -1);
  open = clipLon(open, -180, (lon) => lon >= -180);
  if (open.length < 3) return null;
  open = clipLon(open, 180, (lon) => lon <= 180);
  if (open.length < 3) return null;
  return [...open, open[0] as [number, number]];
}

/**
 * A polygon (outer ring, then holes) as one or more polygons with no edge that jumps the
 * antimeridian. A polygon without such an edge comes back unchanged. Otherwise each ring is
 * unwrapped (holes into the outer ring's frame), then the copies shifted by −360, 0 and +360 are
 * clipped to the world; a copy whose outer ring survives is kept with its surviving holes.
 */
export function splitAtAntimeridian(polygon: Ring[]): Ring[][] {
  if (!polygon.some(jumps)) return [polygon];
  const [outerRing, ...holeRings] = polygon.map(unwrap);
  if (!outerRing) return [];
  // Unwrapping can move the outer ring by ±360 (when it starts past the antimeridian); move each
  // hole into the same frame, so it is clipped together with the part of the ring it lies in.
  const lons = outerRing.map(([lon]) => lon);
  const [lo, hi] = [Math.min(...lons), Math.max(...lons)];
  const inFrame = (hole: Ring): Ring => {
    const lon = (hole[0] as [number, number])[0];
    const k = [0, -360, 360].find((s) => lon + s >= lo && lon + s <= hi) ?? 0;
    return hole.map(([x, y]) => [x + k, y]);
  };
  const unwrapped = [outerRing, ...holeRings.map(inFrame)];
  const out: Ring[][] = [];
  for (const shift of [-360, 0, 360]) {
    const rings = unwrapped.map((r) => clipToWorld(r.map(([lon, lat]) => [lon + shift, lat])));
    const [outer, ...holes] = rings;
    if (!outer) continue;
    out.push([outer, ...holes.filter((h): h is Ring => h !== null)]);
  }
  return out;
}
