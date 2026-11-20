/**
 * The voyage instruction in force: the latest one the executor recorded whose recommendation was
 * carried out. Approval records the route, speed, ETA and bunker stop; this is where the rest of
 * the app reads them back, so an approved instruction is what the map draws, what the vessel's
 * fuel alert is checked against and what `get_vessel_status` projects.
 *
 * The fuel on board along the instructed plan is the stored route calculation's own track for the
 * instructed option (`projectFuelAlongTrack`, with the bunker stop): read, never recomputed here.
 */
import type { Sql } from "@pharos/db";
import { type Id, LatLon, TrackFuel, type VoyageInstructionView } from "@pharos/shared";
import { z } from "zod";
import { dbFact } from "../facts/core.js";

/** The source name on the instruction's facts (a read view, not an agent tool). */
const SOURCE = "voyage_instruction";

export interface InForceInstruction {
  voyageId: Id;
  view: VoyageInstructionView;
  /** Fuel on board along the instructed plan; null when the stored plan carries no fuel track. */
  fuel: TrackFuel | null;
}

type Row = {
  id: number;
  recommendation_id: number;
  voyage_id: number;
  candidate_id: string;
  speed_kn: number;
  eta: string | Date;
  points: unknown;
  stop_arrive_at: string | Date | null;
  stop_depart_at: string | Date | null;
  stop_qty_mt: number | null;
  created_at: string | Date;
  stop_port: string | null;
  outputs: unknown;
};

const Tracks = z.object({
  options: z
    .array(z.object({ candidateId: z.string(), fuel: TrackFuel.nullable().optional() }))
    .default([]),
  stopPlans: z
    .array(z.object({ optionId: z.string(), fuel: TrackFuel.nullable().optional() }))
    .default([]),
});

function fuelOf(outputs: unknown, optionId: string): TrackFuel | null {
  const parsed = Tracks.safeParse(outputs);
  if (!parsed.success) return null;
  const stop = parsed.data.stopPlans.find((s) => s.optionId === optionId);
  if (stop) return stop.fuel ?? null;
  return parsed.data.options.find((o) => o.candidateId === optionId)?.fuel ?? null;
}

const iso = (d: string | Date) => new Date(d).toISOString();

function toInstruction(r: Row): InForceInstruction | null {
  const track = z.array(LatLon).min(2).safeParse(r.points);
  if (!track.success) return null;
  const at = (field: string) => ({ table: "voyage_instructions", rowId: r.id, field });
  const stop = r.stop_port;
  return {
    voyageId: r.voyage_id,
    fuel: fuelOf(r.outputs, r.candidate_id),
    view: {
      recommendationId: r.recommendation_id,
      optionId: r.candidate_id,
      instructedAt: iso(r.created_at),
      track: track.data,
      stopPortName: stop,
      facts: {
        speedKn: dbFact(SOURCE, at("speedKn"), "Instructed speed", r.speed_kn, "kn"),
        eta: dbFact(SOURCE, at("eta"), "Instructed ETA at the destination (UTC)", iso(r.eta), null),
        stopArriveAt:
          stop && r.stop_arrive_at
            ? dbFact(
                SOURCE,
                at("stopArriveAt"),
                `Arrives at ${stop} (UTC)`,
                iso(r.stop_arrive_at),
                null,
              )
            : null,
        stopDepartAt:
          stop && r.stop_depart_at
            ? dbFact(
                SOURCE,
                at("stopDepartAt"),
                `Departs ${stop} (UTC)`,
                iso(r.stop_depart_at),
                null,
              )
            : null,
        stopQtyMt:
          stop && r.stop_qty_mt !== null
            ? dbFact(SOURCE, at("stopQtyMt"), `Bunkers at ${stop}`, r.stop_qty_mt, "mt")
            : null,
      },
    },
  };
}

/** Every voyage's instruction in force, by voyage id (one voyage when `voyageId` is given). */
export async function inForceInstructions(
  sql: Sql,
  voyageId?: Id,
): Promise<Map<Id, InForceInstruction>> {
  const rows = await sql<Row[]>`
    select distinct on (vi.voyage_id)
      vi.id, vi.recommendation_id, vi.voyage_id, vi.candidate_id, vi.speed_kn, vi.eta, vi.points,
      vi.stop_arrive_at, vi.stop_depart_at, vi.stop_qty_mt, vi.created_at,
      p.name as stop_port, c.outputs
    from voyage_instructions vi
      join recommendations r on r.id = vi.recommendation_id and r.status = 'executed'
      join calculations c on c.id = vi.calculation_id
      left join ports p on p.id = vi.stop_port_id
    ${voyageId === undefined ? sql`` : sql`where vi.voyage_id = ${voyageId}`}
    order by vi.voyage_id, vi.id desc`;
  const out = new Map<Id, InForceInstruction>();
  for (const r of rows) {
    const instruction = toInstruction(r);
    if (instruction) out.set(r.voyage_id, instruction);
  }
  return out;
}
