/**
 * What a vessel carries for its next call, as facts for the vessel panel (a read view; the agent
 * reads the same values through the stop plans' port-call facts). Raw database values only: crew,
 * provisions in person-days, waste tanks, and each out-of-date chart or publication with the
 * edition on board and the current one.
 */
import type { World } from "@pharos/db";
import { outdatedOnBoard } from "@pharos/domain";
import type { Vessel, VesselNeedsFacts } from "@pharos/shared";
import { dbFact } from "./core.js";

export const VESSEL_NEEDS_VIEW = "vessel_needs";

export function vesselNeedsFacts(world: World, vessel: Vessel): VesselNeedsFacts | null {
  const stores = vessel.stores;
  if (!stores) return null;
  const V = vessel.name;
  const row = (field: string) => ({ table: "vessels", rowId: vessel.id, field: `stores.${field}` });
  const f = (field: string, label: string, value: number, unit: string | null) =>
    dbFact(VESSEL_NEEDS_VIEW, row(field), `${V}: ${label}`, value, unit);
  return {
    crew: f("crew", "crew on board", stores.crew, null),
    provisionsPersonDays: f(
      "provisionsPersonDays",
      "provisions on board (person-days)",
      stores.provisionsPersonDays,
      null,
    ),
    sludgeM3: f("sludgeM3", "sludge on board", stores.sludgeM3, "m3"),
    sludgeCapacityM3: f("sludgeCapacityM3", "sludge tank capacity", stores.sludgeCapacityM3, "m3"),
    sewageM3: f("sewageM3", "sewage in the holding tank", stores.sewageM3, "m3"),
    sewageCapacityM3: f(
      "sewageCapacityM3",
      "sewage holding tank capacity",
      stores.sewageCapacityM3,
      "m3",
    ),
    outdated: outdatedOnBoard(stores.onBoard, world.nauticalItems).map((item) => {
      const k = stores.onBoard.findIndex((o) => o.itemId === item.itemId);
      const held = stores.onBoard[k];
      return {
        onBoard: held
          ? dbFact(
              VESSEL_NEEDS_VIEW,
              row(`onBoard.${k}.edition`),
              `${V}: ${item.kind} ${item.itemId} (${item.title}) edition on board`,
              held.edition,
              null,
            )
          : null,
        current: dbFact(
          VESSEL_NEEDS_VIEW,
          { table: "nautical_items", rowId: item.itemId, field: "edition" },
          `${item.kind} ${item.itemId} (${item.title}) current edition`,
          item.edition,
          null,
        ),
      };
    }),
  };
}
