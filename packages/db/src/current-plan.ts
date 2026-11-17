/**
 * The voyage's current plan as the one fuel calculation sees it: the rest of the planned route at
 * the planned speed from the latest noon report, and one rule for port waiting times. Pure.
 */
import { projectFuelAlongTrack, remainingRoutePoints, sailedNmAt } from "@pharos/domain";
import type { Id, TrackFuel, WeatherGrid } from "@pharos/shared";
import { voyageState } from "./seed/demo-plan.js";
import { DEMO_SCENARIO } from "./seed/scenario.js";
import type { World } from "./seed/types.js";

/** The longest sub-step (nm) of every along-track walk. */
export const TRACK_STEP_NM = 20;

/** "seed" when the clock is pinned (the recorded demo); "latest" reads the newest AIS-derived row. */
export type CongestionMode = "seed" | "latest";

/**
 * Hours a vessel waits at the port: the latest seeded reading in "seed" mode; in "latest" mode the
 * newest AIS-derived reading, falling back to the seeded one. 0 when the port has no reading.
 */
export function waitingHoursAt(world: World, portId: Id, mode: CongestionMode): number {
  const newest = (source: "seed" | "ais") =>
    world.portCongestion
      .filter((c) => c.portId === portId && c.source === source)
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime() || b.id - a.id)[0];
  const row = (mode === "latest" ? newest("ais") : undefined) ?? newest("seed");
  return row?.waitingHours ?? 0;
}

/**
 * Fuel on board along the rest of the planned route at the planned speed, from the latest noon
 * report, with the safety margin of the demo scenario and no stop. `probesNm` asks for the fuel on
 * board at distances along that route.
 */
export function currentPlanFuel(
  world: World,
  voyageId: Id,
  weather: WeatherGrid | null,
  probesNm: number[] = [],
): TrackFuel {
  const { voyage, path, report } = voyageState(world, voyageId);
  return projectFuelAlongTrack({
    startAt: report.ts.toISOString(),
    points: remainingRoutePoints(path, sailedNmAt(path, report.ts)),
    speedKn: voyage.plannedSpeedKn,
    stepNm: TRACK_STEP_NM,
    curve: path.curve,
    weather,
    robMt: report.robMt,
    safetyMarginDays: DEMO_SCENARIO.safetyMarginDays,
    stop: null,
    probesNm,
  });
}
