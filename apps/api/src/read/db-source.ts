/**
 * Database-backed ReadSource (what `server.ts` serves; responses are tagged `x-pharos-data: db`).
 * Vessels and voyages come from the stored world through the same builders as the fixture source.
 * Inbox items, quotes and recommendations are read from their tables. A recommendation's facts
 * are re-derived from the calculation it references, never from stored model text: a bunker
 * plan's option facts, or a route plan's approved-route facts as `plan_route_speed` returned them.
 * Its gate origin is the stored gate result of the answer that proposed it; its order state comes
 * from purchase_orders.
 */
import { loadWorld, type Sql } from "@pharos/db";
import {
  BunkerPlan,
  BunkerPlanInput,
  CheckResult,
  type ErpSyncStatus,
  ExtractionOutput,
  type Fact,
  type Id,
  type InboxItem,
  type InboxItemDetail,
  IsoDateTime,
  type QuoteView,
  type RecommendationView,
  RouteCandidate,
  RouteSpeedResult,
  ShipType,
} from "@pharos/shared";
import { z } from "zod";
import { calcFact } from "../ai/tools/common.js";
import { TOOL as PLAN_TOOL } from "../ai/tools/plan-bunkering.js";
import { routeFactOfRow, routeSpeedFactRows, subjectLabel } from "../routing/facts.js";
import type { ReadSource } from "./source.js";
import { buildVessels, buildVoyages } from "./world-views.js";

/** postgres.js returns timestamptz as text here (the Drizzle client sets that parser). */
const iso = (v: string | Date): string => new Date(v).toISOString();
const isoOrNull = (v: string | Date | null): string | null => (v === null ? null : iso(v));

// ---------- inbox ----------

interface InboxRow {
  id: number;
  kind: "email" | "pdf";
  sender: string | null;
  subject: string | null;
  received_at: string;
  status: InboxItem["extractionStatus"] | null;
  raw_output?: unknown;
  check_results?: unknown;
  error?: string | null;
  body_text?: string;
}

const toInboxItem = (r: InboxRow): InboxItem => ({
  documentId: r.id,
  sender: r.sender,
  subject: r.subject,
  receivedAt: iso(r.received_at),
  kind: r.kind,
  // An extraction row is written with the document; until it finishes it reads `pending`.
  extractionStatus: r.status ?? "pending",
});

/** Top-level documents with their latest extraction, newest first. */
function inboxRows(sql: Sql, id?: Id) {
  const detail = id !== undefined;
  return sql<InboxRow[]>`
    select d.id, d.kind, d.sender, d.subject, d.received_at, e.status
      ${detail ? sql`, d.body_text, e.raw_output, e.check_results, e.error` : sql``}
    from documents d
    left join lateral (
      select status, raw_output, check_results, error from extractions
      where document_id = d.id order by id desc limit 1
    ) e on true
    where d.parent_id is null ${detail ? sql`and d.id = ${id}` : sql``}
    order by d.id desc`;
}

async function inboxItem(sql: Sql, id: Id): Promise<InboxItemDetail | null> {
  const [row] = await inboxRows(sql, id);
  if (!row) return null;
  const extraction = ExtractionOutput.safeParse(row.raw_output);
  const checks = z.array(CheckResult).safeParse(row.check_results ?? []);
  return {
    ...toInboxItem(row),
    bodyText: row.body_text ?? "",
    extraction: extraction.success ? extraction.data : null,
    checkResults: checks.success ? checks.data : [],
    error: row.error ?? null,
  };
}

// ---------- quotes ----------

async function quotes(sql: Sql, id?: Id): Promise<QuoteView[]> {
  const rows = await sql<
    {
      id: number;
      supplier_name: string;
      port_name: string;
      currency: QuoteView["currency"];
      barge_fee: number;
      valid_until: string | null;
      status: QuoteView["status"];
      document_id: number | null;
    }[]
  >`
    select q.id, s.name as supplier_name, p.name as port_name, q.currency, q.barge_fee,
           q.valid_until, q.status, e.document_id
    from quotes q
      join suppliers s on s.id = q.supplier_id
      join ports p on p.id = q.port_id
      left join extractions e on e.id = q.extraction_id
    ${id === undefined ? sql`` : sql`where q.id = ${id}`}
    order by q.id desc`;
  if (rows.length === 0) return [];
  const lines = await sql<
    {
      quote_id: number;
      grade: QuoteView["lines"][number]["grade"];
      qty_mt: number;
      price_per_mt: number;
    }[]
  >`
    select quote_id, grade, qty_mt, price_per_mt from quote_lines
    where quote_id in ${sql(rows.map((r) => r.id))} order by id`;
  return rows.map((r) => ({
    id: r.id,
    supplierName: r.supplier_name,
    portName: r.port_name,
    currency: r.currency,
    bargeFee: r.barge_fee,
    validUntil: isoOrNull(r.valid_until),
    status: r.status,
    lines: lines
      .filter((l) => l.quote_id === r.id)
      .map((l) => ({ grade: l.grade, qtyMt: l.qty_mt, pricePerMt: l.price_per_mt })),
    documentId: r.document_id,
  }));
}

// ---------- recommendations ----------

interface RecommendationRow {
  id: number;
  type: RecommendationView["type"];
  status: RecommendationView["status"];
  calculation_id: number;
  option_id: string;
  fact_refs: string[];
  expected_saving_usd: number | null;
  kind: string;
  inputs: unknown;
  outputs: unknown;
  voyage_no: string | null;
  gate_passed: boolean | null;
  order_id: number | null;
  erp_po_number: string | null;
  erp_sync_status: ErpSyncStatus | null;
  instruction_id: number | null;
  instruction_candidate_id: string | null;
  instruction_speed_kn: number | null;
  instruction_eta: string | Date | null;
}

/**
 * The plan's facts for one option, with the ids `plan_bunkering` gave them, so the facts the agent
 * cited when it proposed the option resolve here too.
 */
function bunkerOptionFacts(calculationId: Id, plan: BunkerPlan, optionId: string): Fact[] {
  const index = plan.options.findIndex((o) => o.optionId === optionId);
  const option = plan.options[index];
  if (!option) return [];
  const ref = { id: calculationId, calculator: "planBunkers" };
  const fact = (path: string, label: string, value: number | string, unit: string | null) =>
    calcFact(PLAN_TOOL, ref, path, label, value, unit);
  const at = (field: string) => `options[${index}].${field}`;
  const facts = [
    fact(at("qtyMt"), "Quantity", option.qtyMt, "mt"),
    fact(at("headlinePriceUsdPerMt"), "Headline price", option.headlinePriceUsdPerMt, "USD/mt"),
    fact(at("totalCostUsd"), "Total delivered cost", option.totalCostUsd, "USD"),
    fact(
      at("effectivePriceUsdPerMt"),
      "Effective price (total cost per mt)",
      option.effectivePriceUsdPerMt,
      "USD/mt",
    ),
    fact(at("fuelEuCostUsd"), "FuelEU exposure", option.fuelEuCostUsd, "USD"),
  ];
  if (plan.bestOptionId === optionId) {
    facts.push(fact("bestOptionId", "Best option (lowest total cost, feasible)", optionId, null));
    if (plan.savingVsCheapestHeadlineUsd !== null) {
      facts.push(
        fact(
          "savingVsCheapestHeadlineUsd",
          "Saving against the cheapest headline price, in total cost",
          plan.savingVsCheapestHeadlineUsd,
          "USD",
        ),
      );
    }
  }
  return facts;
}

/** What the view reads of a stored route calculation's inputs (see routing/plan.ts). */
const RouteCalculationInputs = z.object({
  subject: z.string().min(1),
  mmsi: z.string().nullable(),
  destination: z.string().min(1),
  profile: z.union([z.literal("own"), ShipType]),
  optimiser: z.object({
    candidates: z.array(RouteCandidate),
    arriveBy: IsoDateTime.nullable(),
  }),
});

/**
 * A route plan's proposed route: a summary without numbers, and that route's facts (its option,
 * description and the berth window; the recommendation and saving when it is the best route) with
 * the ids `plan_route_speed` gave them. Null when the calculation or the route is unreadable.
 */
function routeOptionView(
  calculationId: Id,
  inputs: unknown,
  outputs: unknown,
  optionId: string,
): { summary: string; facts: Fact[] } | null {
  const stored = RouteCalculationInputs.safeParse(inputs);
  const result = RouteSpeedResult.safeParse(outputs);
  if (!stored.success || !result.success) return null;
  const { subject, mmsi, destination, profile, optimiser } = stored.data;
  const index = result.data.options.findIndex((o) => o.candidateId === optionId);
  const at = optimiser.candidates.findIndex((c) => c.id === optionId);
  const candidate = optimiser.candidates[at];
  if (index < 0 || !candidate) return null;
  const plan = { subject, profile, destination: { name: destination }, input: optimiser };
  const keep = new Set([
    `inputs.optimiser.candidates.${at}.label`,
    "inputs.optimiser.arriveBy",
    ...(optionId === result.data.bestCandidateId ? ["bestCandidateId", "savingVsBaselineUsd"] : []),
  ]);
  const facts = routeSpeedFactRows(plan, result.data, null, { mmsi })
    .filter((row) => row.path.startsWith(`options[${index}].`) || keep.has(row.path))
    .map((row) => routeFactOfRow(calculationId, row));
  return {
    summary: `Instruct ${subjectLabel(plan, mmsi)} to ${destination}: ${candidate.label} (route ${optionId}).`,
    facts,
  };
}

async function recommendations(sql: Sql, id?: Id): Promise<RecommendationView[]> {
  const rows = await sql<RecommendationRow[]>`
    select r.id, r.type, r.status, r.calculation_id, r.option_id, r.fact_refs,
           r.expected_saving_usd, c.kind, c.inputs, c.outputs, vo.voyage_no,
           (m.content -> 'gate' ->> 'passed')::boolean as gate_passed,
           po.id as order_id, po.erp_po_number, po.erp_sync_status,
           vi.id as instruction_id, vi.candidate_id as instruction_candidate_id,
           vi.speed_kn as instruction_speed_kn, vi.eta as instruction_eta
    from recommendations r
      join calculations c on c.id = r.calculation_id
      left join voyages vo on vo.id = c.voyage_id
      -- The ask's stored answer: the agent links its proposals to it, with the gate result.
      left join messages m on m.id = r.message_id
      left join lateral (
        select id, erp_po_number, erp_sync_status from purchase_orders
        where recommendation_id = r.id order by id limit 1
      ) po on true
      -- At most one per recommendation (unique index).
      left join voyage_instructions vi on vi.recommendation_id = r.id
    ${id === undefined ? sql`` : sql`where r.id = ${id}`}
    order by r.id desc`;
  if (rows.length === 0) return [];
  const names = async (table: "suppliers" | "ports") =>
    new Map(
      (await sql<{ id: number; name: string }[]>`select id, name from ${sql(table)}`).map((r) => [
        r.id,
        r.name,
      ]),
    );
  const [supplierNames, portNames] = [await names("suppliers"), await names("ports")];

  return rows.map((r): RecommendationView => {
    const base = {
      id: r.id,
      type: r.type,
      status: r.status,
      calculationId: r.calculation_id,
      optionId: r.option_id,
      expectedSavingUsd: r.expected_saving_usd,
      factRefs: r.fact_refs,
      gatePassed: r.gate_passed,
      order:
        r.order_id === null || r.erp_sync_status === null
          ? null
          : { orderId: r.order_id, erpPoNumber: r.erp_po_number, erpSyncStatus: r.erp_sync_status },
      instruction:
        r.instruction_id === null ||
        r.instruction_candidate_id === null ||
        r.instruction_speed_kn === null ||
        r.instruction_eta === null
          ? null
          : {
              instructionId: r.instruction_id,
              candidateId: r.instruction_candidate_id,
              speedKn: r.instruction_speed_kn,
              eta: new Date(r.instruction_eta).toISOString(),
            },
    };
    if (r.kind === "route_speed") {
      const view = routeOptionView(r.calculation_id, r.inputs, r.outputs, r.option_id);
      return {
        ...base,
        ...(view ?? {
          summary: `Option ${r.option_id} of calculation ${r.calculation_id} (not a readable route plan).`,
          facts: [],
        }),
      };
    }
    const input = BunkerPlanInput.safeParse(r.inputs);
    const plan = BunkerPlan.safeParse(r.outputs);
    const offer = input.success
      ? input.data.options.find((o) => o.optionId === r.option_id)
      : undefined;
    if (r.kind !== "bunker_plan" || !input.success || !plan.success || !offer) {
      return {
        ...base,
        summary: `Option ${r.option_id} of calculation ${r.calculation_id} (not a readable bunker plan).`,
        facts: [],
      };
    }
    const supplier = supplierNames.get(offer.supplierId) ?? `supplier ${offer.supplierId}`;
    const port = portNames.get(offer.portId) ?? `port ${offer.portId}`;
    const stem = r.voyage_no ? ` for the ${r.voyage_no} stem` : "";
    return {
      ...base,
      summary: `Order ${input.data.grade}${stem} from ${supplier} at ${port}.`,
      facts: bunkerOptionFacts(r.calculation_id, plan.data, r.option_id),
    };
  });
}

// ---------- source ----------

export function createDbSource(sql: Sql): ReadSource {
  return {
    dataTag: "db",
    listVessels: async () => buildVessels(await loadWorld(sql)).map((v) => v.summary),
    getVessel: async (id) =>
      buildVessels(await loadWorld(sql)).find((v) => v.summary.id === id)?.detail ?? null,
    listVoyages: async () => buildVoyages(await loadWorld(sql)).map((v) => v.summary),
    getVoyage: async (id) =>
      buildVoyages(await loadWorld(sql)).find((v) => v.summary.id === id)?.detail ?? null,
    listInbox: async () => (await inboxRows(sql)).map(toInboxItem),
    getInboxItem: (id) => inboxItem(sql, id),
    listQuotes: () => quotes(sql),
    getQuote: async (id) => (await quotes(sql, id))[0] ?? null,
    listRecommendations: () => recommendations(sql),
    getRecommendation: async (id) => (await recommendations(sql, id))[0] ?? null,
  };
}
