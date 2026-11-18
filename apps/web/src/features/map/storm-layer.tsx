/**
 * The storm cells a route plan's baseline meets: forecast cells over the heavy-weather limit around
 * the time the ship would be there. Drawn in alarm red like the hazards (they are keep-out areas
 * for this plan), with one callout on the worst cell: its highest wave and when it is over the
 * limit, each a fact chip from the plan (`inputs.stormCells.k.*`).
 */
import type { RoutePlanView } from "@pharos/shared";
import circle from "@turf/circle";
import { useMemo } from "react";
import { Layer, Marker, Source } from "react-map-gl/maplibre";
import type { MapColors } from "./basemap-style";
import { FactCell } from "./fact-cell";
import { LABEL_PRIORITY, useFlipLabel } from "./map-labels";
import { factAtPath } from "./route-facts";

type Cell = NonNullable<RoutePlanView["stormCells"]>[number];

function StormCallout({ plan, cell, index }: { plan: RoutePlanView; cell: Cell; index: number }) {
  const { ref, flip, below } = useFlipLabel<HTMLDivElement>(cell.center.lon, cell.center.lat);
  const fact = (field: string) => factAtPath(plan.facts, `inputs.stormCells.${index}.${field}`);
  return (
    <Marker longitude={cell.center.lon} latitude={cell.center.lat} anchor="center">
      <div className="relative size-0">
        <div
          ref={ref}
          data-testid="storm-callout"
          data-map-label={LABEL_PRIORITY.hazard}
          className={`absolute flex w-max max-w-56 flex-col gap-0.5 rounded-sm border border-alarm/60 bg-ink-950/85 px-1.5 py-1 text-xs ${below ? "top-2" : "bottom-2"} ${flip ? "right-2" : "left-2"}`}
        >
          <span className="text-alarm">
            Storm: waves to <FactCell fact={fact("maxWaveHeightM")} metric="storm-wave" />
          </span>
          <span className="text-text-2">
            <FactCell fact={fact("from")} kind="time" /> to{" "}
            <FactCell fact={fact("to")} kind="time" />
          </span>
        </div>
      </div>
    </Marker>
  );
}

export function StormLayer({ plan, colors }: { plan: RoutePlanView | null; colors: MapColors }) {
  const cells = plan?.stormCells ?? [];
  const data = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: cells.map((c) =>
        circle([c.center.lon, c.center.lat], c.radiusNm, { units: "nauticalmiles", steps: 48 }),
      ),
    }),
    [cells],
  );
  if (!plan || cells.length === 0) return null;
  // The worst cell carries the callout (first of the highest, in the plan's order).
  const worst = cells.reduce(
    (w, c, i) => (c.maxWaveHeightM > (cells[w]?.maxWaveHeightM ?? 0) ? i : w),
    0,
  );
  const cell = cells[worst];
  return (
    <>
      <Source id="storm-cells" type="geojson" data={data}>
        <Layer
          id="storm-fill"
          type="fill"
          paint={{ "fill-color": colors.alarm, "fill-opacity": 0.1 }}
        />
        <Layer
          id="storm-line"
          type="line"
          paint={{ "line-color": colors.alarm, "line-width": 1, "line-dasharray": [2, 2] }}
        />
      </Source>
      {cell ? <StormCallout plan={plan} cell={cell} index={worst} /> : null}
    </>
  );
}
