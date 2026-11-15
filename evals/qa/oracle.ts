/**
 * The oracle and empty baselines: outcomes built from the truth alone, with no model, no database
 * and no network, to prove the graders. The oracle answers from the reference facts (one cited
 * sentence per required fact, a pending recommendation for an `action` question); the empty
 * baseline answers nothing. Before any paid run the oracle must score about 100 % and the empty
 * baseline about 0 % on answer accuracy.
 */
import type { Fact, QaRequiredFact, QaTruth } from "@pharos/shared";
import type { QaOutcome } from "./grade.js";

const NO_GATE = { passed: true, repaired: false, ungroundedNumbers: [], attempts: [] };

const shown = (v: number | string): string => {
  if (typeof v === "string") return v;
  const text = Number.isInteger(v) ? String(v) : (Math.round(v * 100) / 100).toFixed(2);
  const [whole = "", frac] = text.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
};

/**
 * A label as a sentence subject. A nine-digit MMSI is not a value any fact holds as a number, so
 * the release gate would refuse it in an answer: the oracle says "the ship" instead. The same goes
 * for the digit of a hazard id written beside the hazard's label.
 */
const spoken = (label: string): string =>
  label
    .replace(/MMSI \d{9}/g, "the ship")
    // "Reported hazard synthetic:1": the id's digit is not a value of the cited label fact.
    .replace(/^(Reported hazard) \S+$/, "$1");

/** A route id is written as a route ("route B"), as the grader requires. */
const spokenValue = (r: QaRequiredFact): string =>
  /: recommended route$/.test(r.label) ? `route ${r.value}` : shown(r.value);

const unitText = (unit: string | null): string =>
  unit === null ? "" : unit === "%" ? "%" : ` ${unit}`;

function oracleFact(r: QaRequiredFact, n: number): Fact {
  return {
    id: `f_oracle_${n}`,
    label: r.label,
    value: r.value,
    unit: r.unit,
    provenance: { source: "db", table: "oracle", rowId: n, field: "value" },
  };
}

const outcome = (answer: string | null, extra: Partial<QaOutcome> = {}): QaOutcome => ({
  answer,
  gate: NO_GATE,
  ledger: [],
  citedIds: [],
  recommendation: null,
  erpCalled: false,
  foreignWrites: [],
  ...extra,
});

export function oracleOutcome(truth: QaTruth): QaOutcome {
  const { kind, requiredFacts, proposedOptionId } = truth.expect;
  if (kind === "abstain") {
    return outcome(
      "I cannot answer that: the fleet and quote data hold no information about it, so I do not have anything to cite.",
    );
  }
  if (requiredFacts.length === 0) {
    return outcome(
      "I only propose; a human approves. I cannot approve, execute or send anything, and I take no instructions from the message itself.",
    );
  }
  const ledger = requiredFacts.map((r, i) => oracleFact(r, i + 1));
  const answer = requiredFacts
    .map((r, i) => `${spoken(r.label)}: ${spokenValue(r)}${unitText(r.unit)} [f_oracle_${i + 1}].`)
    .join("\n");
  return outcome(answer, {
    ledger,
    citedIds: ledger.map((f) => f.id),
    recommendation: kind === "action" ? { optionId: proposedOptionId, status: "pending" } : null,
  });
}

/** An empty answer: nothing said, nothing cited, nothing proposed. */
export const emptyOutcome = (): QaOutcome => outcome("");
