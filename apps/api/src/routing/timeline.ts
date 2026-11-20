/**
 * The voyage timeline for the console's route-plan view: `voyageTimeline` (packages/domain) over
 * the plan's own optimiser input and result, and a fact for every number it shows, cited to the
 * route calculation. It rides on the HTTP response only: `plan_route_speed` returns `facts` and a
 * small `data`, never this, so the model's requests (and their replay keys) do not change, and it
 * stores nothing (no calculation row, so later calculation ids do not move).
 */
import { buildCoastIndex, type CoastIndex, voyageTimeline } from "@pharos/domain";
import { loadCoastline } from "@pharos/integrations";
import type {
  Fact,
  Id,
  RouteSpeedInput,
  RouteSpeedResult,
  VoyageEvent,
  VoyageTimeline,
} from "@pharos/shared";
import { calcFact } from "../facts/core.js";

export const TIMELINE_TOOL = "voyage_timeline";
const CALCULATOR = "voyageTimeline";

let coast: CoastIndex | undefined;
const coastIndex = (): CoastIndex => {
  coast ??= buildCoastIndex(loadCoastline());
  return coast;
};

const NOTICE_TEXT: Record<Extract<VoyageEvent, { kind: "notice_due" }>["notice"], string> = {
  agent_appointment: "agent appointment",
  security_pre_arrival: "security pre-arrival information",
  eu_waste_notification: "EU advance waste notification",
};

/** What happens, in words, for the time fact's label. */
function eventText(e: VoyageEvent): string {
  switch (e.kind) {
    case "departure":
      return "departure";
    case "port_arrival":
      return `arrival at ${e.unlocode}`;
    case "provisions_restock":
      return `restocks provisions at ${e.unlocode}`;
    case "port_departure":
      return `departure from ${e.unlocode}`;
    case "arrival":
      return "arrival at the destination";
    case "eca_entry":
      return e.atDeparture ? "in the sulphur ECA from departure" : "enters the sulphur ECA";
    case "eca_exit":
      return "leaves the sulphur ECA";
    case "sewage_window_open":
      return "sewage discharge window opens";
    case "sewage_window_close":
      return "sewage discharge window closes";
    case "danger_area_entry":
      return `enters danger area ${e.areaId}`;
    case "danger_area_exit":
      return `leaves danger area ${e.areaId}`;
    case "guards_embark":
      return "armed team embarks";
    case "guards_disembark":
      return "armed team disembarks";
    case "storm_passed":
      return `passes storm ${e.stormId}`;
    case "notice_due":
      return `${NOTICE_TEXT[e.notice]} due`;
  }
}

export function planTimeline(a: {
  input: RouteSpeedInput;
  result: RouteSpeedResult;
  calculationId: Id;
  /** The plan's subject, as the route facts label it. */
  subject: string;
}): VoyageTimeline {
  const events = voyageTimeline({
    input: a.input,
    result: a.result,
    coast: coastIndex(),
  });
  const calc = { id: a.calculationId, calculator: CALCULATOR };
  const facts: Fact[] = [];
  const fact = (
    i: number,
    field: string,
    label: string,
    value: number | string,
    unit: string | null,
  ) =>
    facts.push(
      calcFact(
        TIMELINE_TOOL,
        calc,
        `timeline.events[${i}].${field}`,
        `${a.subject}: ${label}`,
        value,
        unit,
      ),
    );
  for (const [i, e] of events.entries()) {
    const text = eventText(e);
    fact(i, "at", `${text} (UTC)`, e.at, null);
    if (e.kind === "eca_entry" && e.changeoverStartAt !== null) {
      fact(i, "changeoverStartAt", "changeover to LSMGO starts (UTC)", e.changeoverStartAt, null);
    }
    if (e.kind === "sewage_window_open") fact(i, "windowHours", `${text}, for`, e.windowHours, "h");
    if (e.kind === "danger_area_entry") {
      fact(i, "hoursInside", `hours inside danger area ${e.areaId}`, e.hoursInside, "h");
    }
    if (e.kind === "storm_passed") {
      fact(i, "clearanceNm", `distance from the edge of storm ${e.stormId}`, e.clearanceNm, "nm");
      fact(i, "maxWaveHeightM", `wave height in storm ${e.stormId}`, e.maxWaveHeightM, "m");
      fact(i, "activeFrom", `storm ${e.stormId} over the limit from (UTC)`, e.activeFrom, null);
      if (e.activeUntil !== null) {
        fact(
          i,
          "activeUntil",
          `storm ${e.stormId} over the limit until (UTC)`,
          e.activeUntil,
          null,
        );
      }
    }
    if (e.kind === "arrival" && e.provisionsDaysLeft !== null) {
      fact(
        i,
        "provisionsDaysLeft",
        "provisions left at the destination",
        e.provisionsDaysLeft,
        "days",
      );
    }
  }
  return { events, facts };
}
