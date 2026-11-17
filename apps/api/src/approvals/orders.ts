/**
 * The purchase order that fixes a voyage's bunker stop: the latest approved, executing or executed
 * purchase-order proposal of the voyage, read from the calculation it was proposed from (a bunker
 * plan option or a route plan's stop plan).
 */
import type { Sql } from "@pharos/db";
import type { Id } from "@pharos/shared";

export interface ApprovedOrder {
  recommendationId: Id;
  optionId: string;
  qtyMt: number;
  quoteId: Id | null;
}

type Row = {
  id: number;
  option_id: string;
  kind: string;
  inputs: { options?: { optionId: string; quoteId: number | null }[] } | null;
  outputs: {
    options?: { optionId: string; qtyMt: number }[];
    stopPlans?: { optionId: string; qtyMt: number; quoteId: number | null }[];
  } | null;
};

export async function approvedOrderFor(sql: Sql, voyageId: Id): Promise<ApprovedOrder | null> {
  const rows = await sql<Row[]>`
    select r.id, r.option_id, c.kind, c.inputs, c.outputs
    from recommendations r join calculations c on c.id = r.calculation_id
    where r.type = 'purchase_order'
      and r.status in ('approved', 'executing', 'executed')
      and c.voyage_id = ${voyageId}
    order by r.decided_at desc nulls last, r.id desc
    limit 1`;
  const row = rows[0];
  if (!row) return null;
  if (row.kind === "route_speed") {
    const stop = row.outputs?.stopPlans?.find((s) => s.optionId === row.option_id);
    if (!stop) return null;
    return {
      recommendationId: row.id,
      optionId: row.option_id,
      qtyMt: stop.qtyMt,
      quoteId: stop.quoteId,
    };
  }
  const option = row.outputs?.options?.find((o) => o.optionId === row.option_id);
  const input = row.inputs?.options?.find((o) => o.optionId === row.option_id);
  if (!option) return null;
  return {
    recommendationId: row.id,
    optionId: row.option_id,
    qtyMt: option.qtyMt,
    quoteId: input?.quoteId ?? null,
  };
}
