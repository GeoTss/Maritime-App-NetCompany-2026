import { currentVoyage, loadWorld, type Sql, voyageState } from "@pharos/db";
import { bearingDeg, positionAt, sailedNmAt } from "@pharos/domain";
import { type AisProvider, abortableSleep } from "./types.js";

/** One AIS-shaped position per fleet vessel that is underway, placed by the domain's route maths. */
async function fleetMessages(sql: Sql, at: Date): Promise<unknown[]> {
  const world = await loadWorld(sql);
  const out: unknown[] = [];
  for (const vessel of world.vessels) {
    const voyage = currentVoyage(world, vessel.id);
    if (!voyage || voyage.status !== "underway") continue;
    try {
      const { path } = voyageState(world, voyage.id);
      const sailed = sailedNmAt(path, at);
      const pos = positionAt(path, sailed);
      const ahead = positionAt(path, sailed + 1);
      const moving = ahead.lat !== pos.lat || ahead.lon !== pos.lon;
      out.push({
        MessageType: "PositionReport",
        MetaData: {
          MMSI: Number(vessel.mmsi),
          ShipName: vessel.name,
          latitude: pos.lat,
          longitude: pos.lon,
          time_utc: at.toISOString(),
        },
        Message: {
          PositionReport: {
            UserID: Number(vessel.mmsi),
            Latitude: pos.lat,
            Longitude: pos.lon,
            Sog: moving ? voyage.plannedSpeedKn : 0,
            Cog: moving ? bearingDeg(pos, ahead) : null,
            NavigationalStatus: moving ? 0 : 5,
          },
        },
      });
    } catch {
      // a vessel without enough data (e.g. no noon report) is skipped, not fatal
    }
  }
  return out;
}

export function createSimulatorAis(opts: {
  sql: Sql;
  now: () => Date;
  intervalMs: number;
}): AisProvider {
  return {
    mode: "simulator",
    async run(onMessage, signal) {
      while (!signal.aborted) {
        for (const m of await fleetMessages(opts.sql, opts.now())) onMessage(m);
        await abortableSleep(opts.intervalMs, signal);
      }
    },
  };
}
