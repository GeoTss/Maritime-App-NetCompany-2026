/**
 * The vessel facts, built once: what `get_vessel_status` cites and what the vessel read view
 * shows. The tool's output is part of later model requests (recorded replies are keyed on its
 * bytes), so ids, labels and values here are the tool's exactly. The fuel-on-board projection
 * facts stay with the tool: they are stored calculations, and a read must not store one.
 */
import { currentVoyage, voyageState, type World } from "@pharos/db";
import { type Fact, FUEL_GRADES, type FuelGrade, type Vessel } from "@pharos/shared";
import { dbFact } from "./core.js";

export const VESSEL_TOOL = "get_vessel_status";

export interface VesselRowFacts {
  name: Fact;
  imo: Fact;
  /** Fuel on board per grade from the latest noon report; null without a current voyage. */
  robMt: Record<FuelGrade, Fact> | null;
  voyageNo: Fact | null;
  /** The first port call with an ETA at or after `now`, and its ETA. */
  nextPort: Fact | null;
  nextPortEta: Fact | null;
}

export function vesselRowFacts(world: World, vessel: Vessel, now: Date): VesselRowFacts {
  const name = dbFact(
    VESSEL_TOOL,
    { table: "vessels", rowId: vessel.id, field: "name" },
    "Vessel name",
    vessel.name,
    null,
  );
  const imo = dbFact(
    VESSEL_TOOL,
    { table: "vessels", rowId: vessel.id, field: "imo" },
    `IMO of ${vessel.name}`,
    vessel.imo,
    null,
  );
  const voyage = currentVoyage(world, vessel.id);
  if (!voyage) {
    return { name, imo, robMt: null, voyageNo: null, nextPort: null, nextPortEta: null };
  }

  const { report } = voyageState(world, voyage.id);
  const robMt = Object.fromEntries(
    FUEL_GRADES.map((g) => [
      g,
      dbFact(
        VESSEL_TOOL,
        { table: "noon_reports", rowId: report.id, field: `robMt.${g}` },
        `${g} remaining on board (latest noon report)`,
        report.robMt[g],
        "mt",
      ),
    ]),
  ) as Record<FuelGrade, Fact>;
  const voyageNo = dbFact(
    VESSEL_TOOL,
    { table: "voyages", rowId: voyage.id, field: "voyageNo" },
    "Current voyage number",
    voyage.voyageNo,
    null,
  );

  const next = world.portCalls
    .filter((c) => c.voyageId === voyage.id && c.eta.getTime() >= now.getTime())
    .sort((a, b) => a.eta.getTime() - b.eta.getTime())[0];
  const port = next ? world.ports.find((p) => p.id === next.portId) : undefined;
  if (!next || !port) {
    return { name, imo, robMt, voyageNo, nextPort: null, nextPortEta: null };
  }
  return {
    name,
    imo,
    robMt,
    voyageNo,
    nextPort: dbFact(
      VESSEL_TOOL,
      { table: "ports", rowId: port.id, field: "name" },
      "Next port",
      port.name,
      null,
    ),
    nextPortEta: dbFact(
      VESSEL_TOOL,
      { table: "port_calls", rowId: next.id, field: "eta" },
      `ETA at ${port.name} (UTC)`,
      next.eta.toISOString(),
      null,
    ),
  };
}
