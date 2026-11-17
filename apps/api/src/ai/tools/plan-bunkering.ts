/**
 * `plan_bunkering`: ranks the received quotes for each open bunker requirement of a vessel's
 * current voyage (one plan per grade) by total delivered cost; with no vessel named, of every
 * vessel's current voyage. A quote is offered for a grade when it is still valid and has a line of
 * that grade, so a multi-grade quote serves every plan. The planner input is built from the world
 * and the quotes, `planBunkers` computes each plan, and each plan is stored as a calculation that
 * its facts (and any proposal) point at.
 */
import {
  type BunkerOffer,
  buildBunkerPlanInput,
  currentVoyage,
  loadWorld,
  openRequirements,
  optionIdFor,
  type World,
} from "@pharos/db";
import { planBunkers } from "@pharos/domain";
import {
  type BunkerRequirement,
  type Fact,
  PlanBunkeringInput,
  type Quote,
  type QuoteLine,
  type ToolResult,
  type Vessel,
  type Voyage,
} from "@pharos/shared";
import { bunkerPlanFacts, BUNKER_TOOL as TOOL } from "../../facts/bunker.js";
import { dbFact } from "../../facts/core.js";
import {
  addSubject,
  findVessel,
  insertCalculation,
  quoteExpiry,
  runTool,
  type ToolContext,
} from "./common.js";
import { defineTool } from "./define.js";

type PlanOutcome =
  | {
      facts: Fact[];
      plan: {
        calculationId: number;
        grade: BunkerRequirement["grade"];
        bestOptionId: string | null;
        cheapestHeadlineOptionId: string | null;
        options: unknown[];
      };
    }
  | { facts: []; plan: { grade: BunkerRequirement["grade"]; message: string } };

/**
 * Plans one requirement against the valid quotes that offer its grade: the latest quote per
 * supplier and port, as one option each. With several grades on the voyage (`multi`), option ids
 * and plan-level labels carry the grade.
 */
async function planRequirement(
  ctx: ToolContext,
  world: World,
  vesselName: string,
  voyage: Voyage,
  requirement: BunkerRequirement,
  quotes: Quote[],
  multi: boolean,
): Promise<PlanOutcome> {
  const grade = requirement.grade;
  const latest = new Map<string, { quote: Quote; line: QuoteLine }>();
  for (const quote of quotes) {
    const line = world.quoteLines.find((l) => l.quoteId === quote.id && l.grade === grade);
    if (line) latest.set(`${quote.supplierId}:${quote.portId}`, { quote, line });
  }
  const offers: BunkerOffer[] = [];
  for (const { quote: q, line } of [...latest.values()].sort((a, b) => a.quote.id - b.quote.id)) {
    const port = world.ports.find((p) => p.id === q.portId);
    const supplier = world.suppliers.find((s) => s.id === q.supplierId);
    if (!port || !supplier) continue;
    const optionId = optionIdFor(port, supplier);
    offers.push({
      optionId: multi ? `${grade}-${optionId}` : optionId,
      quoteId: q.id,
      supplierId: supplier.id,
      portId: port.id,
      currency: q.currency,
      pricePerMt: line.pricePerMt,
      bargeFee: q.bargeFee,
      qtyMt: line.qtyMt,
    });
  }
  if (offers.length === 0) {
    return {
      facts: [],
      plan: {
        grade,
        message: `No received quotes for ${vesselName}'s open ${grade} requirement yet.`,
      },
    };
  }

  const planInput = buildBunkerPlanInput(world, voyage.id, offers, grade);
  const plan = planBunkers(planInput);
  const calculationId = await insertCalculation(ctx, {
    kind: "bunker_plan",
    inputs: planInput,
    outputs: plan,
    voyageId: voyage.id,
  });
  const describe = (optionId: string) => {
    const offer = offers.find((o) => o.optionId === optionId);
    const supplier = world.suppliers.find((s) => s.id === offer?.supplierId)?.name ?? "?";
    const port = world.ports.find((p) => p.id === offer?.portId)?.name ?? "?";
    return { supplier, port };
  };
  const facts = bunkerPlanFacts({
    calculationId,
    plan,
    scope: multi ? `${grade} plan: ` : "",
    names: describe,
    displacementMt: planInput.curve.load?.displacementMt ?? null,
  });

  return {
    facts,
    plan: {
      calculationId,
      grade,
      bestOptionId: plan.bestOptionId,
      cheapestHeadlineOptionId: plan.cheapestHeadlineOptionId,
      options: plan.options.map((o) => ({
        optionId: o.optionId,
        ...describe(o.optionId),
        feasible: o.feasible,
        infeasibleReasons: o.reasons,
      })),
    },
  };
}

/** One plan per grade: the lowest-id open requirement of each (the planner's own rule). */
function requirementsToPlan(world: World, voyage: Voyage | null): BunkerRequirement[] {
  if (!voyage) return [];
  return openRequirements(world, voyage.id).filter(
    (r, i, all) => all.findIndex((x) => x.grade === r.grade) === i,
  );
}

/** Plans one vessel's current voyage: one plan per open requirement (per grade). */
async function planVessel(ctx: ToolContext, world: World, vessel: Vessel): Promise<ToolResult> {
  const voyage = currentVoyage(world, vessel.id);
  const requirements = requirementsToPlan(world, voyage);
  if (!voyage || requirements.length === 0) {
    return {
      facts: [],
      data: { vessel: vessel.name, message: `${vessel.name} has no open bunker requirement.` },
    };
  }

  // Received, still-valid quotes for the voyage's open requirements, oldest first. A quote
  // links one requirement but may offer other grades too, so every plan sees every quote.
  const now = ctx.now();
  const open = new Set(openRequirements(world, voyage.id).map((r) => r.id));
  const quotes = world.quotes
    .filter(
      (q) =>
        q.requirementId !== null &&
        open.has(q.requirementId) &&
        q.status === "received" &&
        quoteExpiry(q, now) === null,
    )
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id);

  const multi = requirements.length > 1;
  addSubject(ctx, { kind: "vessel", vesselId: vessel.id });
  const outcomes: PlanOutcome[] = [];
  for (const r of requirements) {
    outcomes.push(await planRequirement(ctx, world, vessel.name, voyage, r, quotes, multi));
  }
  const facts = outcomes.flatMap((o) => o.facts);
  // The voyage an answer may mention ("voyage AP-2611"), once for every plan.
  if (facts.length > 0) {
    facts.push(
      dbFact(
        TOOL,
        { table: "voyages", rowId: voyage.id, field: "voyageNo" },
        "Voyage number",
        voyage.voyageNo,
        null,
      ),
    );
  }

  if (multi) {
    return {
      facts,
      data: {
        vessel: vessel.name,
        voyageNo: voyage.voyageNo,
        plans: outcomes.map((o) => o.plan),
      },
    };
  }
  const only = outcomes[0] as PlanOutcome;
  if (!("calculationId" in only.plan)) {
    return { facts: [], data: { vessel: vessel.name, ...only.plan } };
  }
  const { calculationId, ...plan } = only.plan;
  return {
    facts,
    data: { calculationId, vessel: vessel.name, voyageNo: voyage.voyageNo, ...plan },
  };
}

/**
 * With no vessel named, every vessel whose current voyage has an open requirement, in fleet order.
 * One such vessel gets exactly its own result; with several, `data.vessels` holds each vessel's
 * result and every fact label starts with the vessel's name (option ids stay as they are).
 */
async function planFleet(ctx: ToolContext, world: World): Promise<ToolResult> {
  const vessels = [...world.vessels]
    .sort((a, b) => a.id - b.id)
    .filter((v) => requirementsToPlan(world, currentVoyage(world, v.id)).length > 0);
  if (vessels.length === 0) {
    return { facts: [], data: { message: "No vessel has an open bunker requirement." } };
  }
  if (vessels.length === 1) return planVessel(ctx, world, vessels[0] as Vessel);
  const results: ToolResult[] = [];
  for (const v of vessels) {
    const r = await planVessel(ctx, world, v);
    results.push({ ...r, facts: r.facts.map((f) => ({ ...f, label: `${v.name}: ${f.label}` })) });
  }
  return { facts: results.flatMap((r) => r.facts), data: { vessels: results.map((r) => r.data) } };
}

export function planBunkering(ctx: ToolContext, input: PlanBunkeringInput): Promise<ToolResult> {
  return runTool(ctx, TOOL, input, async () => {
    const world = await loadWorld(ctx.sql);
    if (input.vessel === undefined) return planFleet(ctx, world);
    return planVessel(ctx, world, findVessel(world, input.vessel));
  });
}

export const planBunkeringDef = defineTool({
  name: TOOL,
  description:
    "Bunker plans for open fuel requirements: one plan per open requirement (per grade) of a " +
    "vessel's current voyage, or of every vessel's when no vessel is given. Each plan ranks every " +
    "received, still-valid supplier quote by total delivered cost (fuel, barge fee, deviation, " +
    "delay, EU ETS cost and FuelEU Maritime exposure) and checks feasibility (quantity, tank " +
    "space, safety margin, berth window), on the vessel's consumption at its current load " +
    "(displacement). Each plan is stored as a calculation; the result gives each plan's " +
    "calculationId, best option and citable facts per option (with several plans, a plans or " +
    "vessels list).",
  inputSchema: PlanBunkeringInput,
  run: planBunkering,
});
