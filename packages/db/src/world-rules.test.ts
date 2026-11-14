import type { BunkerRequirement, PortCall, Voyage } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import type { World } from "./seed/types.js";
import { currentVoyage, openRequirements } from "./world-rules.js";

const T = (h: number) => new Date(Date.UTC(2026, 10, 14, h));

const voyage = (id: number, vesselId: number, status: Voyage["status"]): Voyage => ({
  id,
  vesselId,
  voyageNo: `V${id}`,
  originPortId: 1,
  destinationPortId: 2,
  plannedSpeedKn: 12,
  plannedRoute: [1, 2],
  status,
  departedAt: null,
});
const call = (id: number, voyageId: number, etaHour: number): PortCall => ({
  id,
  voyageId,
  portId: 1,
  sequence: 0,
  purpose: "load",
  eta: T(etaHour),
  berthWindowStart: null,
  berthWindowEnd: null,
});
const req = (
  id: number,
  voyageId: number,
  grade: BunkerRequirement["grade"],
  status: BunkerRequirement["status"] = "open",
): BunkerRequirement => ({ id, voyageId, grade, qtyMt: 100, status, createdAt: T(0) });

const worldOf = (parts: Partial<World>): World => ({ ...parts }) as World;

describe("currentVoyage", () => {
  it("picks the underway voyage over a planned next voyage", () => {
    const w = worldOf({
      voyages: [voyage(1, 7, "planned"), voyage(2, 7, "underway")],
      portCalls: [call(1, 1, 1)],
    });
    expect(currentVoyage(w, 7)?.id).toBe(2);
  });

  it("orders planned voyages by earliest port-call ETA, not by id", () => {
    const w = worldOf({
      voyages: [voyage(1, 7, "planned"), voyage(2, 7, "planned")],
      portCalls: [call(1, 1, 20), call(2, 1, 22), call(3, 2, 5), call(4, 2, 30)],
    });
    expect(currentVoyage(w, 7)?.id).toBe(2);
  });

  it("breaks ETA ties by id and puts voyages without port calls last", () => {
    const tied = worldOf({
      voyages: [voyage(3, 7, "planned"), voyage(2, 7, "planned"), voyage(1, 7, "planned")],
      portCalls: [call(1, 3, 9), call(2, 2, 9)],
    });
    expect(currentVoyage(tied, 7)?.id).toBe(2);
    const bare = worldOf({
      voyages: [voyage(5, 7, "planned"), voyage(4, 7, "planned")],
      portCalls: [],
    });
    expect(currentVoyage(bare, 7)?.id).toBe(4);
  });

  it("ignores other vessels and non-planned voyages; null when none", () => {
    const w = worldOf({
      voyages: [voyage(1, 8, "underway"), voyage(2, 7, "completed")],
      portCalls: [],
    });
    expect(currentVoyage(w, 7)).toBeNull();
  });
});

describe("openRequirements", () => {
  const w = worldOf({
    bunkerRequirements: [
      req(4, 1, "VLSFO"),
      req(2, 1, "LSMGO"),
      req(3, 1, "VLSFO", "ordered"),
      req(1, 9, "VLSFO"),
    ],
  });
  it("returns the voyage's open requirements ordered by id", () => {
    expect(openRequirements(w, 1).map((r) => r.id)).toEqual([2, 4]);
  });
  it("filters by grade", () => {
    expect(openRequirements(w, 1, "LSMGO").map((r) => r.id)).toEqual([2]);
    expect(openRequirements(w, 1, "HSFO")).toEqual([]);
  });
});
