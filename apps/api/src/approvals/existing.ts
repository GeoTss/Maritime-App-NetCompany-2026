/**
 * The proposal a voyage already has for what a plan's option would propose. Planning again stores a
 * new calculation every time, so "the same proposal" is decided by what it does, not by the
 * calculation it came from:
 *
 * - a purchase order: the voyage's order proposal that buys the same grade from the same quote and
 *   is already approved (the quote is taken), else an open one for the same quantity;
 * - a voyage instruction: one of the voyage for the same option at the same speed that is still
 *   open (pending, approved, executing, failed), or the instruction in force when it is that one.
 *   An instruction that was since replaced by another may be proposed again.
 *
 * Rejected proposals never count. A plan with no voyage of ours (a ship seen on AIS) or an option
 * with no quote falls back to the narrow rule: the pending proposal of the same plan and option.
 * `insertPending` (the assistant's and a person's proposals) and the plan screen both read this.
 */
import type { Sql } from "@pharos/db";
import type { Id, PlanProposal, ProposeBody, RecommendationStatus } from "@pharos/shared";
import { z } from "zod";
import { orderSourceOf } from "../executor/execute.js";

type Db = Sql | Parameters<Parameters<Sql["begin"]>[1]>[0];

export interface ProposalKey {
  type: ProposeBody["type"];
  calculationId: Id;
  optionId: string;
}

/** The order states that mean the quote is taken (the dependency rule's own three). */
const TAKEN: ReadonlySet<RecommendationStatus> = new Set(["approved", "executing", "executed"]);

const Speeds = z.object({
  options: z.array(z.object({ candidateId: z.string(), speedKn: z.number() })).default([]),
  stopPlans: z.array(z.object({ optionId: z.string(), speedKn: z.number() })).default([]),
});

/** The speed a route plan's option sails at: a stop plan's, else a route's. Null when unreadable. */
function speedOf(outputs: unknown, optionId: string): number | null {
  const parsed = Speeds.safeParse(outputs);
  if (!parsed.success) return null;
  return (
    parsed.data.stopPlans.find((s) => s.optionId === optionId)?.speedKn ??
    parsed.data.options.find((o) => o.candidateId === optionId)?.speedKn ??
    null
  );
}

type Row = { id: number; status: RecommendationStatus };

const Security = z.object({
  options: z
    .array(
      z.object({
        candidateId: z.string(),
        security: z.object({ quoteId: z.number().nullable() }).nullable().optional(),
      }),
    )
    .default([]),
});

/** The security quote a route plan's option buys its team from; null when none. */
export function securityQuoteOf(outputs: unknown, optionId: string): Id | null {
  const parsed = Security.safeParse(outputs);
  if (!parsed.success) return null;
  return parsed.data.options.find((o) => o.candidateId === optionId)?.security?.quoteId ?? null;
}
const found = (row: Row | undefined): PlanProposal | null =>
  row ? { recommendationId: row.id, status: row.status } : null;

export async function existingProposal(sql: Db, key: ProposalKey): Promise<PlanProposal | null> {
  const [calc] = await sql<
    { kind: string; inputs: unknown; outputs: unknown; voyage_id: number | null }[]
  >`select kind, inputs, outputs, voyage_id from calculations where id = ${key.calculationId}`;
  if (!calc) return null;
  const samePlan = async () => {
    const [row] = await sql<Row[]>`
      select id, status from recommendations
      where calculation_id = ${key.calculationId} and option_id = ${key.optionId}
        and type = ${key.type} and status = 'pending'
      order by id limit 1`;
    return found(row);
  };
  if (calc.voyage_id === null) return samePlan();

  if (key.type === "purchase_order") {
    const wanted = orderSourceOf({ id: key.calculationId, ...calc }, key.optionId);
    if (typeof wanted === "string" || wanted.quoteId === null) return samePlan();
    const rows = await sql<
      (Row & { option_id: string; cid: number; kind: string; inputs: unknown; outputs: unknown })[]
    >`
      select r.id, r.status, r.option_id, c.id as cid, c.kind, c.inputs, c.outputs
      from recommendations r join calculations c on c.id = r.calculation_id
      where r.type = 'purchase_order' and r.status <> 'rejected' and c.voyage_id = ${calc.voyage_id}
      order by r.id desc`;
    const orders = rows.flatMap((r) => {
      const source = orderSourceOf(
        { id: r.cid, kind: r.kind, inputs: r.inputs, outputs: r.outputs },
        r.option_id,
      );
      const same =
        typeof source !== "string" &&
        source.quoteId === wanted.quoteId &&
        source.grade === wanted.grade;
      return same ? [{ ...r, qtyMt: source.qtyMt }] : [];
    });
    return found(
      orders.find((o) => TAKEN.has(o.status)) ?? orders.find((o) => o.qtyMt === wanted.qtyMt),
    );
  }

  if (key.type === "security_order") {
    const wanted = securityQuoteOf(calc.outputs, key.optionId);
    if (wanted === null) return samePlan();
    const rows = await sql<(Row & { option_id: string; outputs: unknown })[]>`
      select r.id, r.status, r.option_id, c.outputs
      from recommendations r join calculations c on c.id = r.calculation_id
      where r.type = 'security_order' and r.status <> 'rejected' and c.voyage_id = ${calc.voyage_id}
      order by r.id desc`;
    const same = rows.filter((r) => securityQuoteOf(r.outputs, r.option_id) === wanted);
    return found(same.find((o) => TAKEN.has(o.status)) ?? same[0]);
  }

  const speedKn = speedOf(calc.outputs, key.optionId);
  if (speedKn === null) return samePlan();
  const instructions = await sql<(Row & { outputs: unknown })[]>`
    select r.id, r.status, c.outputs
    from recommendations r join calculations c on c.id = r.calculation_id
    where r.type = 'voyage_instruction' and r.status <> 'rejected'
      and r.option_id = ${key.optionId} and c.voyage_id = ${calc.voyage_id}
    order by r.id desc`;
  const same = instructions.filter((i) => speedOf(i.outputs, key.optionId) === speedKn);
  const open = same.find((i) => i.status !== "executed");
  if (open) return found(open);
  const [inForce] = await sql<{ recommendation_id: number }[]>`
    select vi.recommendation_id
    from voyage_instructions vi join recommendations r on r.id = vi.recommendation_id
    where vi.voyage_id = ${calc.voyage_id} and r.status = 'executed'
    order by vi.id desc limit 1`;
  return found(same.find((i) => i.id === inForce?.recommendation_id));
}

/** The voyage's instruction in force (the latest one carried out), for the plan's voyage. */
export async function instructionInForce(sql: Db, calculationId: Id): Promise<PlanProposal | null> {
  const [row] = await sql<Row[]>`
    select r.id, r.status
    from voyage_instructions vi
      join recommendations r on r.id = vi.recommendation_id and r.status = 'executed'
    where vi.voyage_id = (select voyage_id from calculations where id = ${calculationId})
    order by vi.id desc limit 1`;
  return found(row);
}
