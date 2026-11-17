/**
 * Database-backed ReadSource (what `server.ts` serves).
 * Vessels and voyages come from the stored world through the same builders as the fixture source.
 * Inbox items, quotes and recommendations are read from their tables. A recommendation's facts
 * are re-derived from the calculation it references, never from stored model text: a bunker
 * plan's option facts, or a route plan's approved-route facts as `plan_route_speed` returned them.
 * Its gate origin is the stored gate result of the answer that proposed it; its order state comes
 * from purchase_orders.
 */
import { loadWorld, type Sql } from "@pharos/db";
import {
  type AuditEventView,
  AuditEventView as AuditEventViewSchema,
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
  type PortView,
  type QuoteView,
  type RecommendationView,
  RouteCandidate,
  RouteSpeedResult,
  ShipType,
} from "@pharos/shared";
import { z } from "zod";
import { BUNKER_SAVING_PATH, bunkerOptionViewFacts, bunkerScope } from "../facts/bunker.js";
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
  extraction_id?: number | null;
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
      ${detail ? sql`, d.body_text, e.id as extraction_id, e.raw_output, e.check_results, e.error` : sql``}
    from documents d
    left join lateral (
      select id, status, raw_output, check_results, error from extractions
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
    extractionId: row.extraction_id ?? null,
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

/** The path of a route plan's saving: the recommended route and speed against the current plan. */
const ROUTE_SAVING_PATH = "savingVsBaselineUsd";

/** The calculation fact at `path` among a view's facts (a plan's saving), or null. */
const factAt = (facts: Fact[], path: string): Fact | null =>
  facts.find((f) => f.provenance.source === "calculation" && f.provenance.path === path) ?? null;

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
 * A route plan's proposed route: a summary without numbers, the route's description, and that
 * route's facts (its option, description and the berth window; the recommendation and saving when
 * it is the best route) with the ids `plan_route_speed` gave them. Null when the calculation or
 * the route is unreadable.
 */
function routeOptionView(
  calculationId: Id,
  inputs: unknown,
  outputs: unknown,
  optionId: string,
): { summary: string; optionLabel: string; facts: Fact[] } | null {
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
    ...(optionId === result.data.bestCandidateId ? ["bestCandidateId", ROUTE_SAVING_PATH] : []),
  ]);
  const facts = routeSpeedFactRows(plan, result.data, null, { mmsi })
    .filter((row) => row.path.startsWith(`options[${index}].`) || keep.has(row.path))
    .map((row) => routeFactOfRow(calculationId, row));
  return {
    summary: `Instruct ${subjectLabel(plan, mmsi)} to ${destination}: ${candidate.label} (route ${optionId}).`,
    optionLabel: candidate.label,
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
    // The saving's fact, when the proposal has a saving.
    const savingOf = (facts: Fact[], path: string) =>
      r.expected_saving_usd === null ? null : factAt(facts, path);
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
      if (!view) {
        return {
          ...base,
          summary: `Option ${r.option_id} of calculation ${r.calculation_id} (not a readable route plan).`,
          optionLabel: null,
          expectedSaving: null,
          facts: [],
        };
      }
      return { ...base, ...view, expectedSaving: savingOf(view.facts, ROUTE_SAVING_PATH) };
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
        optionLabel: null,
        expectedSaving: null,
        facts: [],
      };
    }
    const options = input.data.options;
    const names = (optionId: string) => {
      const o = options.find((x) => x.optionId === optionId);
      if (!o) return { supplier: "?", port: "?" };
      return {
        supplier: supplierNames.get(o.supplierId) ?? `supplier ${o.supplierId}`,
        port: portNames.get(o.portId) ?? `port ${o.portId}`,
      };
    };
    // The plan's facts for the option, with the ids and labels `plan_bunkering` gave them, so the
    // facts the agent cited when it proposed the option resolve here unchanged.
    const facts = bunkerOptionViewFacts(
      {
        calculationId: r.calculation_id,
        plan: plan.data,
        scope: bunkerScope(input.data.grade, r.option_id),
        names,
        displacementMt: input.data.curve.load?.displacementMt ?? null,
      },
      r.option_id,
    );
    const { supplier, port } = names(r.option_id);
    const stem = r.voyage_no ? ` for the ${r.voyage_no} stem` : "";
    return {
      ...base,
      summary: `Order ${input.data.grade}${stem} from ${supplier} at ${port}.`,
      optionLabel: `${supplier} at ${port}`,
      expectedSaving: savingOf(facts, BUNKER_SAVING_PATH),
      facts,
    };
  });
}

// ---------- ports, audit, world anchor ----------

/** The most audit events one unfiltered list returns (the latest ones). */
export const AUDIT_LIST_LIMIT = 200;

async function ports(sql: Sql): Promise<PortView[]> {
  const rows = await sql<
    { id: number; name: string; unlocode: string; lat: number; lon: number; is_eu: boolean }[]
  >`select id, name, unlocode, lat, lon, is_eu from ports order by id`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unlocode: r.unlocode,
    position: { lat: r.lat, lon: r.lon },
    isEu: r.is_eu,
  }));
}

interface AuditRow {
  id: number;
  recommendation_id: number | null;
  kind: string;
  actor: string;
  detail: unknown;
  at: string;
}

async function auditEvents(sql: Sql, recommendationId: Id | null): Promise<AuditEventView[]> {
  const rows =
    recommendationId === null
      ? await sql<AuditRow[]>`
          select * from (
            select id, recommendation_id, kind, actor, detail, at from audit_events
            order by id desc limit ${AUDIT_LIST_LIMIT}
          ) latest order by id`
      : await sql<AuditRow[]>`
          select id, recommendation_id, kind, actor, detail, at from audit_events
          where recommendation_id = ${recommendationId} order by id`;
  return rows.map((r) =>
    AuditEventViewSchema.parse({
      id: r.id,
      recommendationId: r.recommendation_id,
      kind: r.kind,
      actor: r.actor,
      detail: r.detail ?? null,
      at: iso(r.at),
    }),
  );
}

async function worldAnchor(sql: Sql): Promise<Date | null> {
  const [row] = await sql<{ anchor: string }[]>`select anchor from world_meta where id = 1`;
  return row ? new Date(row.anchor) : null;
}

// ---------- source ----------

export function createDbSource(sql: Sql, now: () => Date): ReadSource {
  return {
    listVessels: async () => buildVessels(await loadWorld(sql), now()).map((v) => v.summary),
    getVessel: async (id) =>
      buildVessels(await loadWorld(sql), now()).find((v) => v.summary.id === id)?.detail ?? null,
    listVoyages: async () => buildVoyages(await loadWorld(sql)).map((v) => v.summary),
    getVoyage: async (id) =>
      buildVoyages(await loadWorld(sql)).find((v) => v.summary.id === id)?.detail ?? null,
    listInbox: async () => (await inboxRows(sql)).map(toInboxItem),
    getInboxItem: (id) => inboxItem(sql, id),
    listQuotes: () => quotes(sql),
    getQuote: async (id) => (await quotes(sql, id))[0] ?? null,
    listRecommendations: () => recommendations(sql),
    getRecommendation: async (id) => (await recommendations(sql, id))[0] ?? null,
    worldAnchor: () => worldAnchor(sql),
    listPorts: () => ports(sql),
    listAuditEvents: (recommendationId) => auditEvents(sql, recommendationId),
  };
}
