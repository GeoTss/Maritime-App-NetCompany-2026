import { demoOffers, fleetRoutePlan, generateWorld, pinnedNow } from "@pharos/db";
import { activeHazardZones, buildRouteGraph, optimiseRouteSpeed } from "@pharos/domain";
import { loadSeaNetwork, recordedLiveData } from "@pharos/integrations";
import { Fact } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import { planTimeline, TIMELINE_TOOL } from "./timeline.js";

const ANCHOR = new Date("2026-11-14T08:00:00Z");
const world = generateWorld({ seed: 20261114, anchor: ANCHOR });
const live = recordedLiveData({ anchor: ANCHOR, ports: world.ports });
const voyage = world.voyages.find((v) => v.voyageNo === "AP-2611");
if (!voyage) throw new Error("no AP-2611");
const plan = fleetRoutePlan(
  world,
  voyage.id,
  buildRouteGraph(loadSeaNetwork().segments),
  live.weather,
  activeHazardZones(live.hazards, pinnedNow(ANCHOR)),
  { congestion: "seed", offers: demoOffers(world), fixedOrder: null },
);
const result = optimiseRouteSpeed(plan.input);

describe("planTimeline", () => {
  const timeline = planTimeline({
    input: plan.input,
    result,
    calculationId: 7,
    subject: plan.subject,
  });

  it("facts cover every timed event", () => {
    expect(timeline.events.length).toBeGreaterThan(2);
    for (const [i, event] of timeline.events.entries()) {
      const fact = timeline.facts.find((f) => f.id.endsWith(`timeline.events.${i}.at`));
      expect(fact, `${event.kind} at`).toBeDefined();
      expect(fact?.value).toBe(event.at);
      expect(fact?.provenance).toMatchObject({ source: "calculation", calculationId: 7 });
    }
    for (const f of timeline.facts) {
      expect(() => Fact.parse(f)).not.toThrow();
      expect(f.id.startsWith(`f_${TIMELINE_TOOL}_`)).toBe(true);
    }
  });

  it("a port call's arrival and the numbers it carries are cited", () => {
    const arrival = timeline.events.findIndex((e) => e.kind === "arrival");
    expect(arrival).toBeGreaterThan(0);
    const end = timeline.events[arrival];
    if (end?.kind === "arrival" && end.provisionsDaysLeft !== null) {
      const days = timeline.facts.find((f) =>
        f.id.endsWith(`timeline.events.${arrival}.provisionsDaysLeft`),
      );
      expect(days?.unit).toBe("days");
    }
  });
});
