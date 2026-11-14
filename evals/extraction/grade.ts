/**
 * The extraction grader: one golden case's truth against what the pipeline did with its email.
 * Programmatic and type-aware; no model judges anything, and the truth is only read.
 *
 * Comparison per field (the predicted side is the pipeline's normalised view, its world ids
 * mapped to the truth's codes):
 *   prices and the barge fee   equal to the cent (|a - b| < 0.005)
 *   quantity                   exactly equal (mt)
 *   dates                      the same ISO day
 *   vessel / port / supplier   the same IMO / UN/LOCODE / supplier key; currency the same code
 *
 * Verdicts: `correct` = equal, both null counting as equal; `missing` = truth non-null, predicted
 * null; `wrong` = predicted non-null and not equal, including a value where the truth is null.
 *
 * Line alignment: each truth line with a grade takes the first unpaired predicted line of the same
 * grade; the lines left on both sides are then paired in order. A truth line left over has every
 * field missing; a predicted line left over (an extra line) is graded against null: each value
 * it holds is wrong, each null correct.
 */
import { SUPPLIERS, type World } from "@pharos/db";
import {
  CRITICAL_FIELDS,
  type Currency,
  type ExtractionTruth,
  type FuelGrade,
  type Id,
  type IsoDate,
  type NormalisedLine,
  type NormalisedView,
  type TruthStatus,
} from "@pharos/shared";

/** Failures recorded apart from wrong answers: a case with one is in no accuracy denominator. */
export const ERROR_KINDS = ["api_error", "truncation", "refusal", "replay_miss"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** The extraction status after `processDocument` has finished with the row. */
export type PipelineStatus = "extracted" | "needs_review" | "not_a_quote" | "failed";

/** What the pipeline did with one golden email (ruling R11, plus the failed checks). */
export interface CaseOutcome {
  status: PipelineStatus;
  /** `extractions.kind`: what the model said the document is; null when there is no output. */
  kind: "quote" | "not_a_quote" | null;
  /** `normaliseExtraction` of the stored raw output; null when there is none. */
  normalised: NormalisedView | null;
  /** `extractions.error`. */
  error: string | null;
  /** Set when the failure is an API error, a truncation, a refusal or a replay miss. */
  errorKind: ErrorKind | null;
  /** Names of the checks that failed (`extractions.check_results`). */
  failedChecks: string[];
}

export const GRADED_FIELDS = [
  "vessel",
  "port",
  "supplier",
  "currency",
  "validUntil",
  "deliveryFrom",
  "deliveryTo",
  "bargeFee",
  "grade",
  "quantity",
  "price",
] as const;
export type GradedField = (typeof GRADED_FIELDS)[number];
/** Compile-time check: every critical field is a graded field. */
const CRITICAL: ReadonlySet<GradedField> = new Set<GradedField>(CRITICAL_FIELDS);
export const isCritical = (f: GradedField): boolean => CRITICAL.has(f);

export type Verdict = "correct" | "wrong" | "missing";

export interface FieldGrade {
  field: GradedField;
  /** "vessel", "lines.<truth line>.price", or "lines.extra.<predicted line>.price". */
  path: string;
  critical: boolean;
  verdict: Verdict;
  truth: string | number | null;
  predicted: string | number | null;
}

/** World ids mapped to the codes the truth uses. An id the world does not know maps to null. */
export interface EntityKeys {
  vesselImo(id: Id): string | null;
  portUnlocode(id: Id): string | null;
  supplierKey(id: Id): string | null;
}

export function entityKeys(world: World): EntityKeys {
  const imo = new Map(world.vessels.map((v) => [v.id, v.imo]));
  const unlocode = new Map(world.ports.map((p) => [p.id, p.unlocode]));
  const keyByName = new Map(SUPPLIERS.map((s) => [s.name, s.key]));
  const key = new Map(world.suppliers.map((s) => [s.id, keyByName.get(s.name) ?? null]));
  return {
    vesselImo: (id) => imo.get(id) ?? null,
    portUnlocode: (id) => unlocode.get(id) ?? null,
    supplierKey: (id) => key.get(id) ?? null,
  };
}

/** The pipeline's values in the truth's terms. */
export interface PredictedQuote {
  vesselImo: string | null;
  portUnlocode: string | null;
  supplierKey: string | null;
  currency: Currency | null;
  validUntil: IsoDate | null;
  deliveryFrom: IsoDate | null;
  deliveryTo: IsoDate | null;
  bargeFee: number | null;
  lines: NormalisedLine[];
}

/** A resolved id the world cannot name stays non-null, so it grades as wrong, never as missing. */
function code(id: Id | null, lookup: (id: Id) => string | null): string | null {
  return id === null ? null : (lookup(id) ?? `unknown id ${id}`);
}

export function toTruthSpace(view: NormalisedView, keys: EntityKeys): PredictedQuote {
  return {
    vesselImo: code(view.vesselId, keys.vesselImo),
    portUnlocode: code(view.portId, keys.portUnlocode),
    supplierKey: code(view.supplierId, keys.supplierKey),
    currency: view.currency,
    validUntil: view.validUntil,
    deliveryFrom: view.deliveryFrom,
    deliveryTo: view.deliveryTo,
    bargeFee: view.bargeFee,
    lines: view.lines,
  };
}

export interface LinePair {
  truth: number | null;
  predicted: number | null;
}

/** See the module comment. Truth lines come first in truth order, then extra predicted lines. */
export function alignLines(
  truth: readonly { grade: FuelGrade | null }[],
  predicted: readonly { grade: FuelGrade | null }[],
): LinePair[] {
  const partner = new Map<number, number>();
  const taken = new Set<number>();
  truth.forEach((t, i) => {
    if (t.grade === null) return;
    const j = predicted.findIndex((p, k) => !taken.has(k) && p.grade === t.grade);
    if (j >= 0) {
      partner.set(i, j);
      taken.add(j);
    }
  });
  const restTruth = truth.map((_, i) => i).filter((i) => !partner.has(i));
  const restPredicted = predicted.map((_, j) => j).filter((j) => !taken.has(j));
  restTruth.forEach((i, n) => {
    const j = restPredicted[n];
    if (j !== undefined) {
      partner.set(i, j);
      taken.add(j);
    }
  });
  return [
    ...truth.map((_, i) => ({ truth: i, predicted: partner.get(i) ?? null })),
    ...predicted.flatMap((_, j) => (taken.has(j) ? [] : [{ truth: null, predicted: j }])),
  ];
}

const sameCent = (a: number, b: number) => Math.abs(a - b) < 0.005 + 1e-9;
const same = <T>(a: T, b: T) => a === b;

function verdictOf<T>(truth: T | null, predicted: T | null, equal: (a: T, b: T) => boolean) {
  if (truth === null) return predicted === null ? "correct" : "wrong";
  if (predicted === null) return "missing";
  return equal(truth, predicted) ? "correct" : "wrong";
}

export interface CaseGrade {
  id: string;
  tags: string[];
  source: ExtractionTruth["source"];
  truthKind: ExtractionTruth["expected"]["kind"];
  truthStatus: TruthStatus;
  status: PipelineStatus;
  kind: CaseOutcome["kind"];
  failedChecks: string[];
  /** An API error, truncation, refusal or replay miss: listed apart, graded on nothing. */
  error: { kind: ErrorKind; message: string } | null;
  /** The stored message of a graded `failed` case (unusable output, a pipeline fault). */
  failure: string | null;
  /** Empty when the truth has no quote, or on an error. */
  fields: FieldGrade[];
  lines: LinePair[];
  /** The pipeline's values in truth terms; null when there was no output (or on an error). */
  predicted: PredictedQuote | null;
  /** Every critical field correct; null when the truth has no quote (or on an error). */
  criticalAllCorrect: boolean | null;
  /** Stored as extracted although the truth is not a clean quote or a critical field is off. */
  unsafeAutoAccept: boolean | null;
  /** Truth extracted, pipeline anything else. */
  falseReview: boolean | null;
  /** Truth needs_review only: at least one of `truth.expected.reviewChecks` failed. */
  reviewCheckMatched: boolean | null;
}

const EMPTY_VIEW: NormalisedView = {
  vesselId: null,
  portId: null,
  supplierId: null,
  currency: null,
  validUntil: null,
  deliveryFrom: null,
  deliveryTo: null,
  bargeFee: null,
  lines: [],
};

function gradeFields(
  truth: NonNullable<ExtractionTruth["expected"]["quote"]>,
  p: PredictedQuote,
): { fields: FieldGrade[]; lines: LinePair[] } {
  const fields: FieldGrade[] = [];
  const add = <T extends string | number>(
    field: GradedField,
    path: string,
    t: T | null,
    v: T | null,
    equal: (a: T, b: T) => boolean,
  ) =>
    fields.push({
      field,
      path,
      critical: isCritical(field),
      verdict: verdictOf(t, v, equal),
      truth: t,
      predicted: v,
    });
  add("vessel", "vessel", truth.vesselImo, p.vesselImo, same);
  add("port", "port", truth.portUnlocode, p.portUnlocode, same);
  add("supplier", "supplier", truth.supplierKey, p.supplierKey, same);
  add("currency", "currency", truth.currency, p.currency, same);
  add("validUntil", "validUntil", truth.validUntil, p.validUntil, same);
  add("deliveryFrom", "deliveryFrom", truth.deliveryFrom, p.deliveryFrom, same);
  add("deliveryTo", "deliveryTo", truth.deliveryTo, p.deliveryTo, same);
  add("bargeFee", "bargeFee", truth.bargeFee, p.bargeFee, sameCent);

  const lines = alignLines(truth.lines, p.lines);
  for (const pair of lines) {
    const t = pair.truth === null ? null : truth.lines[pair.truth];
    const v = pair.predicted === null ? null : p.lines[pair.predicted];
    if (t) {
      const at = `lines.${pair.truth}`;
      add("grade", `${at}.grade`, t.grade, v?.grade ?? null, same);
      add("quantity", `${at}.quantity`, t.qtyMt, v?.qtyMt ?? null, same);
      add("price", `${at}.price`, t.pricePerMt, v?.pricePerMt ?? null, sameCent);
    } else if (v) {
      // A line the truth does not have: its fields are graded against null, so a value is
      // wrong and a null is correct.
      const at = `lines.extra.${pair.predicted}`;
      add("grade", `${at}.grade`, null, v.grade, same);
      add("quantity", `${at}.quantity`, null, v.qtyMt, same);
      add("price", `${at}.price`, null, v.pricePerMt, sameCent);
    }
  }
  return { fields, lines };
}

export function gradeCase(
  truth: ExtractionTruth,
  outcome: CaseOutcome,
  keys: EntityKeys,
): CaseGrade {
  const e = truth.expected;
  const base = {
    id: truth.id,
    tags: truth.tags,
    source: truth.source,
    truthKind: e.kind,
    truthStatus: e.status,
    status: outcome.status,
    kind: outcome.kind,
    failedChecks: outcome.failedChecks,
  };
  if (outcome.errorKind !== null) {
    return {
      ...base,
      error: { kind: outcome.errorKind, message: outcome.error ?? "" },
      failure: null,
      fields: [],
      lines: [],
      predicted: null,
      criticalAllCorrect: null,
      unsafeAutoAccept: null,
      falseReview: null,
      reviewCheckMatched: null,
    };
  }

  const predicted = outcome.normalised === null ? null : toTruthSpace(outcome.normalised, keys);
  const graded =
    e.kind === "quote" && e.quote !== null
      ? gradeFields(e.quote, predicted ?? toTruthSpace(EMPTY_VIEW, keys))
      : { fields: [], lines: [] };
  const criticalOff = graded.fields.some((f) => f.critical && f.verdict !== "correct");
  const extracted = outcome.status === "extracted";
  return {
    ...base,
    error: null,
    failure: outcome.status === "failed" ? (outcome.error ?? "failed without a message") : null,
    fields: graded.fields,
    lines: graded.lines,
    predicted,
    criticalAllCorrect: e.kind === "quote" && e.quote !== null ? !criticalOff : null,
    unsafeAutoAccept: extracted && (e.kind !== "quote" || e.status !== "extracted" || criticalOff),
    falseReview: e.status === "extracted" && !extracted,
    reviewCheckMatched:
      e.status === "needs_review"
        ? e.reviewChecks.some((c) => outcome.failedChecks.includes(c))
        : null,
  };
}
