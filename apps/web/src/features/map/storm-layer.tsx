/**
 * Heavy weather on the map: the forecast grid squares over the wave limit around the time the
 * plan's ship would be there, drawn in the storm purple as one area (adjacent squares tile, and a
 * single outline runs round the whole area: edges two squares share are left out). One callout per
 * storm (squares that touch), at its north-east corner, cites its worst square's highest wave and
 * when it is over the limit, and the recommended
 * route's highest wave, so a route through the area reads as "ahead of the storm". Every number is
 * a fact chip; the geometry is the API's (`stormCells[k].box`).
 */
import type { Box, RoutePlanView } from "@pharos/shared";
import { useMemo } from "react";
import { Layer, Marker, Source } from "react-map-gl/maplibre";
import { DataTag } from "@/components/source-badge";
import type { MapColors } from "./basemap-style";
import { FactCell } from "./fact-cell";
import { LABEL_PRIORITY, useFlipLabel } from "./map-labels";
import { dbFact, factAtPath } from "./route-facts";

type Cell = NonNullable<RoutePlanView["stormCells"]>[number];
type Position = [number, number];

const corners = (b: Box): Position[] => [
  [b.minLon, b.minLat],
  [b.maxLon, b.minLat],
  [b.maxLon, b.maxLat],
  [b.minLon, b.maxLat],
];

const key = (p: Position) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

/**
 * The squares as polygons, and the outline of their union as line segments: every square edge
 * that no other square shares. Squares of one grid share whole edges, so this is exact.
 */
export function stormArea(boxes: Box[]): { squares: Position[][][]; outline: Position[][] } {
  const squares = boxes.map((b) => {
    const c = corners(b);
    return [[...c, c[0] as Position]];
  });
  const edges = new Map<string, { edge: Position[]; count: number }>();
  for (const b of boxes) {
    const c = corners(b);
    for (let i = 0; i < 4; i++) {
      const a = c[i] as Position;
      const z = c[(i + 1) % 4] as Position;
      const k = [key(a), key(z)].sort().join("|");
      const seen = edges.get(k);
      if (seen) seen.count++;
      else edges.set(k, { edge: [a, z], count: 1 });
    }
  }
  const outline = [...edges.values()].filter((e) => e.count === 1).map((e) => e.edge);
  return { squares, outline };
}

/** Cells whose squares touch (an edge or a corner) belong to one storm: their indexes, grouped. */
export function stormsOf(cells: readonly Cell[]): number[][] {
  const eps = 1e-6;
  const touch = (a: Box, b: Box) =>
    a.minLon <= b.maxLon + eps &&
    b.minLon <= a.maxLon + eps &&
    a.minLat <= b.maxLat + eps &&
    b.minLat <= a.maxLat + eps;
  const group = cells.map((_, i) => i);
  const root = (i: number): number => (group[i] === i ? i : root(group[i] as number));
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i]?.box;
      const b = cells[j]?.box;
      if (a && b && touch(a, b)) group[root(j)] = root(i);
    }
  }
  const out = new Map<number, number[]>();
  cells.forEach((_, i) => {
    out.set(root(i), [...(out.get(root(i)) ?? []), i]);
  });
  return [...out.values()];
}

/** Where the callout hangs: the area's north-east corner, so the area itself stays in view. */
function cornerOf(cells: Cell[]): { lat: number; lon: number } {
  const boxes = cells.flatMap((c) => (c.box ? [c.box] : []));
  if (boxes.length === 0) return cells[0]?.center ?? { lat: 0, lon: 0 };
  return {
    lat: Math.max(...boxes.map((b) => b.maxLat)),
    lon: Math.max(...boxes.map((b) => b.maxLon)),
  };
}

function StormCallout({
  plan,
  index,
  at,
  synthetic,
  scenario,
}: {
  plan: RoutePlanView;
  index: number;
  at: { lat: number; lon: number };
  /** The labelled synthetic demo storm, tagged as the demo hazard is. */
  synthetic: boolean;
  /** A demo scenario storm: its window is the presenter's, not the forecast's. */
  scenario: boolean;
}) {
  const { ref, flip, below } = useFlipLabel<HTMLDivElement>(at.lon, at.lat);
  // Stored inputs of the calculation are cited as its row's fields (`inputs.stormCells.k.*`).
  const fact = (field: string) => dbFact(plan.facts, `inputs.stormCells.${index}.${field}`);
  const best = plan.result.options.findIndex((o) => o.candidateId === plan.result.bestCandidateId);
  const bestWave = best < 0 ? undefined : factAtPath(plan.facts, `options[${best}].maxWaveHeightM`);
  return (
    <Marker longitude={at.lon} latitude={at.lat} anchor="center">
      <div className="relative size-0">
        <div
          ref={ref}
          data-testid="storm-callout"
          data-map-label={LABEL_PRIORITY.hazard}
          className={`absolute flex w-max max-w-60 flex-col gap-0.5 rounded-sm border border-storm/70 bg-ink-950/85 px-1.5 py-1 text-xs ${below ? "top-2" : "bottom-2"} ${flip ? "right-2" : "left-2"}`}
        >
          <span className="flex items-center gap-1.5 text-storm">
            <span>
              Heavy weather: waves to <FactCell fact={fact("maxWaveHeightM")} metric="storm-wave" />
            </span>
            {synthetic ? <DataTag kind="synthetic" /> : null}
          </span>
          {scenario ? (
            <span className="text-text-2">
              Scenario weather, <FactCell fact={fact("from")} kind="time" /> to{" "}
              <FactCell fact={fact("to")} kind="time" />: a route meeting it then goes round it
            </span>
          ) : (
            <span className="text-text-2">
              Over the limit as the route passes, <FactCell fact={fact("from")} kind="time" /> to{" "}
              <FactCell fact={fact("to")} kind="time" />
            </span>
          )}
          {bestWave ? (
            <span className="text-text-2" data-testid="storm-best-route">
              Route {plan.result.bestCandidateId} meets at most{" "}
              <FactCell fact={bestWave} metric="storm-best-wave" />
            </span>
          ) : null}
        </div>
      </div>
    </Marker>
  );
}

export function StormLayer({ plan, colors }: { plan: RoutePlanView | null; colors: MapColors }) {
  const cells = plan?.stormCells ?? [];
  const area = useMemo(() => stormArea(cells.flatMap((c) => (c.box ? [c.box] : []))), [cells]);
  const squares = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: area.squares.map((coordinates) => ({
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates },
        properties: {},
      })),
    }),
    [area],
  );
  const outline = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: area.outline.map((coordinates) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates },
        properties: {},
      })),
    }),
    [area],
  );
  if (!plan || cells.length === 0) return null;
  // One callout per storm (cells whose squares touch), carried by its worst cell (first of the
  // highest, in the plan's order), so two storms never share one callout's figures.
  const storms = stormsOf(cells);
  return (
    <>
      <Source id="storm-squares" type="geojson" data={squares}>
        <Layer
          id="storm-fill"
          type="fill"
          paint={{ "fill-color": colors.storm, "fill-opacity": 0.22, "fill-antialias": false }}
        />
      </Source>
      <Source id="storm-outline" type="geojson" data={outline}>
        <Layer
          id="storm-line"
          type="line"
          paint={{ "line-color": colors.storm, "line-width": 1.5, "line-opacity": 0.9 }}
        />
      </Source>
      {storms.map((storm) => {
        const worst = storm.reduce(
          (w, i) => ((cells[i]?.maxWaveHeightM ?? 0) > (cells[w]?.maxWaveHeightM ?? 0) ? i : w),
          storm[0] as number,
        );
        const members = storm.map((i) => cells[i] as Cell);
        return (
          <StormCallout
            key={cells[worst]?.id}
            plan={plan}
            index={worst}
            at={cornerOf(members)}
            synthetic={members.some((c) => c.synthetic)}
            scenario={cells[worst]?.scenario === true}
          />
        );
      })}
    </>
  );
}
