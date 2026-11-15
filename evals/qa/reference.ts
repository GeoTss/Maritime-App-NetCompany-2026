/**
 * Reference answers for the Q&A golden set, computed by code over the seeded Q&A world: the seed
 * world (seed 20261114, anchor 2026-11-14T08:00Z) plus the two demo inbox quotes (Kestrel at
 * Marsaxlokk, Strait Line at Gibraltar). The demo quotes are inserted as rows with the values of
 * `buildDemoEmails` (the same values the Phase 2 extraction of fixtures/demo-inbox/01 and 02
 * produces), exactly as `insertDemoQuotes` does in the database.
 *
 * Nothing here is a typed expected value. Every value is read from the world or computed by
 * `@pharos/domain` / `@pharos/db`, mirroring what the agent's tools do (labels are the tools'
 * labels, from the Task 4 report). reference.test.ts checks the labels and values against a dry
 * run of the real tools on a real database.
 */
import {
  type BunkerOffer,
  buildBunkerPlanInput,
  currentVoyage,
  fobProjectionInput,
  generateWorld,
  openRequirements,
  optionIdFor,
  voyageState,
  type World,
} from "@pharos/db";
import {
  calculate,
  ciiRating,
  co2Tonnes,
  etsCost,
  etsCoverage,
  planBunkers,
  projectFuelOnBoard,
  remainingFobLegs,
  totalNm,
} from "@pharos/domain";
import {
  type CiiInput,
  type EtsCostInput,
  type QaRequiredFact,
  QaTruth,
  type Quote,
  type QuoteLine,
  type Vessel,
} from "@pharos/shared";
import { quoteExpiry } from "../../apps/api/src/ai/tools/common.js";
import { ASK_FIXTURE_NOW } from "../../apps/api/src/ask/demo-fixture.js";
import { buildDemoEmails } from "../../apps/api/src/read/fixtures.js";
import { EVAL_ANCHOR, EVAL_SEED } from "../extraction/world.js";
import { DEMO_VESSEL, type FactRef, type QuestionSpec } from "./questions.js";

export const QA_SEED = EVAL_SEED;
export const QA_ANCHOR = EVAL_ANCHOR;
/** The agent's clock for Q&A runs (the demo fixture's: five minutes after the anchor). */
export const QA_NOW = ASK_FIXTURE_NOW;

/** The Q&A world: the seed world plus the two demo quotes, as `insertDemoQuotes` stores them. */
export function qaWorld(): World {
  const world = generateWorld({ seed: QA_SEED, anchor: QA_ANCHOR });
  const vessel = must(
    world.vessels.find((v) => v.name.endsWith(DEMO_VESSEL)),
    "demo vessel",
  );
  const voyage = must(currentVoyage(world, vessel.id), "demo voyage");
  const requirement = must(openRequirements(world, voyage.id)[0], "demo requirement");
  let quoteId = Math.max(0, ...world.quotes.map((q) => q.id));
  let lineId = Math.max(0, ...world.quoteLines.map((l) => l.id));
  const quotes: Quote[] = [];
  const lines: QuoteLine[] = [];
  for (const supplierKey of ["kestrel", "straitline"]) {
    const email = must(
      buildDemoEmails(world).find((e) => e.option.supplierKey === supplierKey),
      `demo email ${supplierKey}`,
    );
    const o = email.option;
    quotes.push({
      id: ++quoteId,
      supplierId: must(
        world.suppliers.find((s) => s.name === email.supplierName),
        email.supplierName,
      ).id,
      portId: must(
        world.ports.find((p) => p.unlocode === o.portLocode),
        o.portLocode,
      ).id,
      requirementId: requirement.id,
      deliveryFrom: null,
      deliveryTo: null,
      validUntil: null,
      currency: o.currency,
      bargeFee: o.bargeFee,
      status: "received",
      extractionId: null,
      receivedAt: email.receivedAt,
    });
    lines.push({
      id: ++lineId,
      quoteId,
      grade: requirement.grade,
      qtyMt: o.qtyMt,
      pricePerMt: o.pricePerMt,
    });
  }
  return {
    ...world,
    quotes: [...world.quotes, ...quotes],
    quoteLines: [...world.quoteLines, ...lines],
  };
}

function must<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`Q&A world has no ${what}`);
  return v;
}

/** Absolute tolerance for a numeric required fact: exact for integers, else about half a rounding step. */
export function toleranceFor(value: number): number {
  if (Number.isInteger(value)) return 0;
  const abs = Math.abs(value);
  return abs >= 100 ? 0.5 : abs >= 1 ? 0.06 : 0.005;
}

const fact = (
  label: string,
  value: number | string | boolean,
  unit: string | null,
): QaRequiredFact => ({
  label,
  // Booleans are carried as strings: QaRequiredFact values are number | string.
  value: typeof value === "boolean" ? String(value) : value,
  unit,
  tolerance: typeof value === "number" ? toleranceFor(value) : 0,
});

function vesselOf(world: World, name: string): Vessel {
  return must(
    world.vessels.find(
      (v) => v.name === `MV ${name}` || v.name === `MT ${name}` || v.name === name,
    ),
    `vessel ${name}`,
  );
}

/** The plan for the demo vessel's open requirement, as plan_bunkering computes it. */
export function qaPlan(world: World) {
  const vessel = vesselOf(world, DEMO_VESSEL);
  const voyage = must(currentVoyage(world, vessel.id), "voyage");
  const requirement = must(openRequirements(world, voyage.id)[0], "requirement");
  const open = new Set(openRequirements(world, voyage.id).map((r) => r.id));
  const quotes = world.quotes
    .filter(
      (q) =>
        q.requirementId !== null &&
        open.has(q.requirementId) &&
        q.status === "received" &&
        quoteExpiry(q, QA_NOW) === null,
    )
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id);
  const latest = new Map<string, { quote: Quote; line: QuoteLine }>();
  for (const quote of quotes) {
    const line = world.quoteLines.find(
      (l) => l.quoteId === quote.id && l.grade === requirement.grade,
    );
    if (line) latest.set(`${quote.supplierId}:${quote.portId}`, { quote, line });
  }
  const offers: BunkerOffer[] = [];
  const names = new Map<string, { supplier: string; port: string }>();
  for (const { quote, line } of [...latest.values()].sort((a, b) => a.quote.id - b.quote.id)) {
    const port = must(
      world.ports.find((p) => p.id === quote.portId),
      "port",
    );
    const supplier = must(
      world.suppliers.find((s) => s.id === quote.supplierId),
      "supplier",
    );
    const optionId = optionIdFor(port, supplier);
    names.set(optionId, { supplier: supplier.name, port: port.name });
    offers.push({
      optionId,
      quoteId: quote.id,
      supplierId: supplier.id,
      portId: port.id,
      currency: quote.currency,
      pricePerMt: line.pricePerMt,
      bargeFee: quote.bargeFee,
      qtyMt: line.qtyMt,
    });
  }
  const result = planBunkers(buildBunkerPlanInput(world, voyage.id, offers, requirement.grade));
  return { result, names };
}

const PLAN_OPTION_FIELDS = {
  headlinePrice: ["headlinePriceUsdPerMt", "headline price", "USD/mt"],
  totalCost: ["totalCostUsd", "total delivered cost", "USD"],
  delayHours: ["delayHours", "delay", "h"],
  etsCost: ["etsCostUsd", "EU ETS cost", "USD"],
  feasible: ["feasible", "feasible", null],
  rank: ["rank", "rank by total cost", null],
} as const;

/** Resolves one fact reference to the required fact the agent's tool would return for it. */
export function resolveFact(world: World, ref: FactRef): QaRequiredFact {
  switch (ref.src) {
    case "status": {
      const vessel = vesselOf(world, ref.vessel);
      const voyage = must(currentVoyage(world, vessel.id), `voyage of ${ref.vessel}`);
      const { report, remainingLegs } = voyageState(world, voyage.id);
      const f = ref.field;
      if (f === "nextPort") {
        const next = world.portCalls
          .filter((c) => c.voyageId === voyage.id && c.eta.getTime() >= QA_NOW.getTime())
          .sort((a, b) => a.eta.getTime() - b.eta.getTime())[0];
        const port = must(
          world.ports.find((p) => p.id === next?.portId),
          `next port of ${ref.vessel}`,
        );
        return fact("Next port", port.name, null);
      }
      if ("rob" in f) {
        return fact(`${f.rob} remaining on board (latest noon report)`, report.robMt[f.rob], "mt");
      }
      const fob = projectFuelOnBoard(fobProjectionInput(world, voyage.id, remainingLegs));
      if ("required" in f) {
        return fact(
          `${f.required} needed for the rest of the voyage`,
          fob.requiredMt[f.required],
          "mt",
        );
      }
      return fact(
        `${f.shortfall} shortfall to keep the margin`,
        fob.shortfallMt[f.shortfall],
        "mt",
      );
    }
    case "fleet": {
      const vessel = vesselOf(world, ref.vessel);
      const voyage = must(currentVoyage(world, vessel.id), `voyage of ${ref.vessel}`);
      const n = vessel.name;
      switch (ref.field) {
        case "name":
          return fact(`${n}: vessel name`, n, null);
        case "imo":
          return fact(`${n}: IMO number`, vessel.imo, null);
        case "voyageNo":
          return fact(`${n}: current voyage number`, voyage.voyageNo, null);
        case "voyageStatus":
          return fact(`${n}: current voyage status`, voyage.status, null);
      }
      break;
    }
    case "quote": {
      const supplierName = must(
        buildDemoEmails(world).find((e) => e.option.supplierKey === ref.supplier),
        `demo supplier ${ref.supplier}`,
      ).supplierName;
      const supplier = must(
        world.suppliers.find((s) => s.name === supplierName),
        supplierName,
      );
      const port = must(
        world.ports.find((p) => p.unlocode === ref.port),
        ref.port,
      );
      const quote = must(
        world.quotes.find(
          (q) => q.supplierId === supplier.id && q.portId === port.id && q.status === "received",
        ),
        `quote ${supplier.name} at ${port.name}`,
      );
      const line = must(
        world.quoteLines.find((l) => l.quoteId === quote.id),
        "quote line",
      );
      const prefix = `${supplier.name} quote at ${port.name}`;
      const linePrefix = `${prefix}, ${line.grade}`;
      switch (ref.field) {
        case "price":
          return fact(`${linePrefix}: price per mt`, line.pricePerMt, `${quote.currency}/mt`);
        case "qty":
          return fact(`${linePrefix}: quantity offered`, line.qtyMt, "mt");
        case "bargeFee":
          return fact(`${prefix}: barge fee`, quote.bargeFee, quote.currency);
        case "supplier":
          return fact(`${prefix}: supplier`, supplier.name, null);
        case "port":
          return fact(`${prefix}: port`, port.name, null);
        case "status":
          return fact(`${prefix}: status`, quote.status, null);
      }
      break;
    }
    case "plan": {
      const { result, names } = qaPlan(world);
      switch (ref.field) {
        case "bestOption":
          return fact(
            "Best option (lowest total cost, feasible)",
            must(result.bestOptionId, "best option"),
            null,
          );
        case "cheapestHeadlineOption":
          return fact(
            "Option with the cheapest headline price",
            must(result.cheapestHeadlineOptionId, "cheapest headline option"),
            null,
          );
        case "saving":
          return fact(
            "Saving of the best option against the cheapest headline price, in total cost",
            must(result.savingVsCheapestHeadlineUsd, "saving"),
            "USD",
          );
        default: {
          const optionId = must(ref.option, "plan option");
          const option = must(
            result.options.find((o) => o.optionId === optionId),
            `plan option ${optionId}`,
          );
          const who = must(names.get(optionId), `names of ${optionId}`);
          const [key, label, unit] = PLAN_OPTION_FIELDS[ref.field];
          return fact(`${optionId} (${who.supplier}, ${who.port}): ${label}`, option[key], unit);
        }
      }
    }
    case "emissions": {
      const vessel = vesselOf(world, ref.vessel);
      const voyage = must(currentVoyage(world, vessel.id), `voyage of ${ref.vessel}`);
      const { path, remainingLegs } = voyageState(world, voyage.id);
      const rate = (key: string): number =>
        must(
          world.referenceRates.find((x) => x.key === key),
          `${key} rate`,
        ).value;
      const year = world.meta.anchor.getUTCFullYear();
      const co2T = co2Tonnes(
        projectFuelOnBoard(fobProjectionInput(world, voyage.id, remainingLegs)).requiredMt,
      );
      const voyageCo2T = co2Tonnes(
        projectFuelOnBoard(fobProjectionInput(world, voyage.id, remainingFobLegs(path, 0)))
          .requiredMt,
      );
      const voyageNm = totalNm(path);
      const etsInput: EtsCostInput = {
        co2T,
        coverage: etsCoverage(path.origin.isEu, path.destination.isEu),
        year,
        euaPriceEur: rate("EUA"),
        eurUsd: rate("EURUSD"),
      };
      const ciiInput: CiiInput = {
        shipType: vessel.shipType,
        dwt: vessel.dwt,
        co2T: voyageCo2T,
        distanceNm: voyageNm,
        year,
      };
      const ets = etsCost(etsInput);
      const cii = ciiRating(ciiInput);
      const v = vessel.name;
      const CII_UNIT = "g CO₂/dwt·nm";
      switch (ref.field) {
        case "co2T":
          return fact(`${v}: CO₂ from the fuel still needed this voyage`, co2T, "t CO₂");
        case "etsCostUsd":
          return fact(`${v}: EU ETS cost for the rest of the voyage, in USD`, ets.costUsd, "USD");
        case "etsCostEur":
          return fact(`${v}: EU ETS cost for the rest of the voyage, in EUR`, ets.costEur, "EUR");
        case "voyageCo2T":
          return fact(`${v}: CO₂ of the whole voyage as planned`, voyageCo2T, "t CO₂");
        case "voyageNm":
          return fact(`${v}: distance of the whole voyage as planned`, voyageNm, "nm");
        case "ciiRating":
          return fact(`${v}: CII rating of the voyage as planned`, cii.rating, null);
        case "ciiAttained":
          return fact(`${v}: attained CII of the voyage as planned`, cii.attained, CII_UNIT);
        case "ciiRequired":
          return fact(`${v}: required CII for the year`, cii.required, CII_UNIT);
      }
      break;
    }
    case "calc": {
      const operands = ref.operands.map((o) => resolveFact(world, o));
      const numeric = operands.map((o) => {
        if (typeof o.value !== "number") throw new Error(`calc operand ${o.label} is not a number`);
        return { value: o.value, unit: o.unit };
      });
      const out = calculate(ref.op, numeric);
      return fact(
        `${ref.op} of ${operands.map((o) => o.label).join(" and ")}`,
        out.value,
        out.unit,
      );
    }
  }
  throw new Error("unreachable fact ref");
}

/** The golden truth of one question, parsed by QaTruth. */
export function buildTruth(world: World, spec: QuestionSpec): QaTruth {
  const requiredFacts = spec.facts.map((r) => resolveFact(world, r));
  const proposedOptionId =
    spec.kind === "action"
      ? must(qaPlan(world).result.bestOptionId, "best option for the proposal")
      : null;
  return QaTruth.parse({
    id: spec.id,
    tags: [spec.category, ...(spec.tags ?? [])],
    question: spec.question,
    expect: {
      kind: spec.kind,
      requiredFacts,
      proposedOptionId,
      mustNotPropose: spec.mustNotPropose,
    },
  });
}
