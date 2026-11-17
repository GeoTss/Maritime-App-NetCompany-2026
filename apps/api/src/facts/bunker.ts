/**
 * The facts a stored bunker plan yields, built in one place: `plan_bunkering` returns
 * `bunkerPlanFacts` for each plan it stores, and the approval view re-derives one option's facts
 * from the stored calculation with `bunkerOptionViewFacts`. Both use the same ids, labels, units
 * and provenance, so a fact the agent cited reads the same on the approval card. Pure: the caller
 * loads the plan and the supplier and port names.
 */
import type { BunkerOptionResult, BunkerPlan, Fact, FuelGrade, Id } from "@pharos/shared";
import { calcFact, dbFact } from "./core.js";

/** The tool name in every bunker fact id. */
export const BUNKER_TOOL = "plan_bunkering";
const CALCULATOR = "planBunkers";

/**
 * Option fields returned as facts, with their units. A fact's label is
 * `<optionId> (<supplier>, <port>): <name>` (see `bunkerOptionLabel`).
 */
export const BUNKER_OPTION_FACTS: [keyof BunkerOptionResult, string, string | null][] = [
  ["rank", "rank by total cost", null],
  ["feasible", "feasible", null],
  ["qtyMt", "quantity", "mt"],
  ["headlinePriceUsdPerMt", "headline price", "USD/mt"],
  ["totalCostUsd", "total delivered cost", "USD"],
  ["delayHours", "delay", "h"],
  ["etsCostUsd", "EU ETS cost", "USD"],
  ["fuelEuCostUsd", "FuelEU exposure", "USD"],
];

/** An option fact's label: the option id, its supplier and port, then the field's name. */
export const bunkerOptionLabel = (optionId: string, supplier: string, port: string, name: string) =>
  `${optionId} (${supplier}, ${port}): ${name}`;

/**
 * The plan's displacement (the load on the planner's curve, from the voyage's cargo and ballast),
 * cited on the stored input; with several grades the label starts `<grade> plan: `.
 */
export const BUNKER_DISPLACEMENT_LABEL = "Vessel displacement";
export const BUNKER_DISPLACEMENT_FIELD = "inputs.curve.load.displacementMt";

/** The path of the plan's saving: the best option against the cheapest headline price. */
export const BUNKER_SAVING_PATH = "savingVsCheapestHeadlineUsd";

type OptionFactSpec = (typeof BUNKER_OPTION_FACTS)[number];

const optionSpec = (field: keyof BunkerOptionResult): OptionFactSpec => {
  const spec = BUNKER_OPTION_FACTS.find(([f]) => f === field);
  if (!spec) throw new Error(`no bunker option fact for ${field}`);
  return spec;
};

/**
 * The option facts the approval view shows, in order. The effective price is the view's own: the
 * tool never returns it.
 */
const VIEW_OPTION_FACTS: OptionFactSpec[] = [
  optionSpec("qtyMt"),
  optionSpec("headlinePriceUsdPerMt"),
  optionSpec("totalCostUsd"),
  ["effectivePriceUsdPerMt", "effective price (total cost per mt)", "USD/mt"],
  optionSpec("fuelEuCostUsd"),
];

/** What the facts of one stored plan are built from. */
export interface BunkerFactContext {
  /** The stored calculation every fact points at. */
  calculationId: Id;
  plan: BunkerPlan;
  /** Prefix of the plan-level labels: `<grade> plan: ` with several grades, else empty. */
  scope: string;
  /** The supplier and port an option id names. */
  names: (optionId: string) => { supplier: string; port: string };
  /** The load on the planner's curve, or null when the curve carries none. */
  displacementMt: number | null;
}

/**
 * The plan-level label prefix, rebuilt from a stored plan: with several grades on a voyage every
 * option id starts `<grade>-`, and the plan's labels start `<grade> plan: `.
 */
export const bunkerScope = (grade: FuelGrade, optionId: string): string =>
  optionId.startsWith(`${grade}-`) ? `${grade} plan: ` : "";

const planRef = (c: BunkerFactContext) => ({ id: c.calculationId, calculator: CALCULATOR });

/** One option's facts for the given fields, in their order. */
function optionFacts(c: BunkerFactContext, index: number, specs: OptionFactSpec[]): Fact[] {
  const o = c.plan.options[index];
  if (!o) return [];
  const { supplier, port } = c.names(o.optionId);
  return specs.map(([field, name, unit]) =>
    calcFact(
      BUNKER_TOOL,
      planRef(c),
      `options[${index}].${field}`,
      bunkerOptionLabel(o.optionId, supplier, port, name),
      o[field] as number | boolean,
      unit,
    ),
  );
}

function bestOptionFact(c: BunkerFactContext, bestOptionId: string): Fact {
  return calcFact(
    BUNKER_TOOL,
    planRef(c),
    "bestOptionId",
    `${c.scope}Best option (lowest total cost, feasible)`,
    bestOptionId,
    null,
  );
}

function savingFact(c: BunkerFactContext, saving: number): Fact {
  return calcFact(
    BUNKER_TOOL,
    planRef(c),
    BUNKER_SAVING_PATH,
    `${c.scope}Saving of the best option against the cheapest headline price, in total cost`,
    saving,
    "USD",
  );
}

/**
 * Every fact `plan_bunkering` returns for one stored plan, in its order: each option's fields, the
 * displacement, the best and cheapest-headline options, the saving, and the calculation id.
 */
export function bunkerPlanFacts(c: BunkerFactContext): Fact[] {
  const { plan, calculationId, scope } = c;
  const facts = plan.options.flatMap((_, i) => optionFacts(c, i, BUNKER_OPTION_FACTS));
  if (c.displacementMt !== null) {
    facts.push(
      dbFact(
        BUNKER_TOOL,
        { table: "calculations", rowId: calculationId, field: BUNKER_DISPLACEMENT_FIELD },
        `${scope}${BUNKER_DISPLACEMENT_LABEL}`,
        c.displacementMt,
        "mt",
      ),
    );
  }
  if (plan.bestOptionId !== null) facts.push(bestOptionFact(c, plan.bestOptionId));
  if (plan.cheapestHeadlineOptionId !== null) {
    facts.push(
      calcFact(
        BUNKER_TOOL,
        planRef(c),
        "cheapestHeadlineOptionId",
        `${scope}Option with the cheapest headline price`,
        plan.cheapestHeadlineOptionId,
        null,
      ),
    );
  }
  if (plan.savingVsCheapestHeadlineUsd !== null) {
    facts.push(savingFact(c, plan.savingVsCheapestHeadlineUsd));
  }
  // The id an answer may mention ("plan 3"), citable like any other number.
  facts.push(
    calcFact(
      BUNKER_TOOL,
      planRef(c),
      "calculationId",
      `${scope}Bunker plan calculation id`,
      calculationId,
      null,
    ),
  );
  return facts;
}

/**
 * The facts the approval view shows for one option of a stored plan: its quantity, headline price,
 * total cost, effective price and FuelEU exposure, then, when it is the best option, the best
 * option and the saving. Empty when the plan has no such option.
 */
export function bunkerOptionViewFacts(c: BunkerFactContext, optionId: string): Fact[] {
  const index = c.plan.options.findIndex((o) => o.optionId === optionId);
  if (index < 0) return [];
  const facts = optionFacts(c, index, VIEW_OPTION_FACTS);
  if (c.plan.bestOptionId === optionId) {
    facts.push(bestOptionFact(c, optionId));
    if (c.plan.savingVsCheapestHeadlineUsd !== null) {
      facts.push(savingFact(c, c.plan.savingVsCheapestHeadlineUsd));
    }
  }
  return facts;
}
