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
 *
 * Security quotes (Track 3) are graded against the pipeline's own security record, the
 * `securityQuote` that `evaluateExtraction` returns and the workflow stores, and its status.
 * The pipeline makes that record only when every check passes (evaluate-security.ts), so:
 *   - a truth-`extracted` case gets every field graded; with no record (sent to review, failed,
 *     or read as another kind) each truth value is missing;
 *   - a truth-`needs_review` case gets its fields graded only when a record was stored (an
 *     auto-accept); sent to review, it has no record and no field grades, and its outcome is
 *     measured by needs-review recall.
 * Comparison: day rate and fixed fees to the cent, team size and minimum days exactly, validity
 * the same ISO day, provider / vessel / ports / currency the same name / IMO / UN/LOCODE / code.
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
  SECURITY_CRITICAL_FIELDS,
  type TruthSecurityQuote,
  type TruthStatus,
} from "@pharos/shared";

/** Failures recorded apart from wrong answers: a case with one is in no accuracy denominator. */
export const ERROR_KINDS = ["api_error", "truncation", "refusal", "replay_miss"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** The extraction status after `processDocument` has finished with the row. */
export type PipelineStatus = "extracted" | "needs_review" | "not_a_quote" | "failed";

/** `extractions.kind`: what the model said the document is. */
export type OutputKind = "quote" | "not_a_quote" | "security_quote";

/**
 * The pipeline's security record (`NormalisedSecurityQuote` of apps/api evaluate-security.ts):
 * what `evaluateExtraction` returns and the workflow stores in `security_quotes`, in world ids.
 */
export interface SecurityRecord {
  providerId: Id;
  vesselImo: string | null;
  embarkPortId: Id;
  disembarkPortId: Id;
  teamSize: number;
  dayRate: number;
  fixedFees: number;
  minDays: number;
  currency: Currency;
  validUntil: IsoDate | null;
}

/** What the pipeline did with one golden email (ruling R11, plus the failed checks). */
export interface CaseOutcome {
  status: PipelineStatus;
  /** `extractions.kind`: what the model said the document is; null when there is no output. */
  kind: OutputKind | null;
  /** The security record the pipeline stored (status extracted, kind security_quote); else null. */
  security?: SecurityRecord | null;
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

/**
 * Fields that make an `extracted` case unsafe when wrong or missing: the critical fields plus
 * the barge fee and the supplier, which decide what is paid and to whom (user decision
 * 2026-11-14, I6). Critical-field accuracy still counts only `CRITICAL_FIELDS`.
 */
const UNSAFE_IF_OFF: ReadonlySet<GradedField> = new Set<GradedField>([
  ...CRITICAL_FIELDS,
  "bargeFee",
  "supplier",
]);

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
  /** The security provider's seeded name (Track 3). */
  providerName?(id: Id): string | null;
}

export function entityKeys(world: World): EntityKeys {
  const imo = new Map(world.vessels.map((v) => [v.id, v.imo]));
  const unlocode = new Map(world.ports.map((p) => [p.id, p.unlocode]));
  const keyByName = new Map(SUPPLIERS.map((s) => [s.name, s.key]));
  const key = new Map(world.suppliers.map((s) => [s.id, keyByName.get(s.name) ?? null]));
  const provider = new Map((world.securityProviders ?? []).map((p) => [p.id, p.name]));
  return {
    vesselImo: (id) => imo.get(id) ?? null,
    portUnlocode: (id) => unlocode.get(id) ?? null,
    supplierKey: (id) => key.get(id) ?? null,
    providerName: (id) => provider.get(id) ?? null,
  };
}

// ---------- security quotes (Track 3) ----------

export const SECURITY_GRADED_FIELDS = [
  "provider",
  "vessel",
  "embarkPort",
  "disembarkPort",
  "teamSize",
  "dayRate",
  "currency",
  "fixedFees",
  "minDays",
  "validUntil",
] as const;
export type SecurityField = (typeof SECURITY_GRADED_FIELDS)[number];
/** Compile-time check: every security critical field is a graded security field. */
const SECURITY_CRITICAL: ReadonlySet<SecurityField> = new Set<SecurityField>(
  SECURITY_CRITICAL_FIELDS,
);
export const isSecurityCritical = (f: SecurityField): boolean => SECURITY_CRITICAL.has(f);
/** Fields that make a stored security quote unsafe when wrong or missing: critical + provider. */
const SECURITY_UNSAFE_IF_OFF: ReadonlySet<SecurityField> = new Set<SecurityField>([
  ...SECURITY_CRITICAL_FIELDS,
  "provider",
]);

export interface SecurityFieldGrade {
  field: SecurityField;
  critical: boolean;
  verdict: Verdict;
  truth: string | number | null;
  predicted: string | number | null;
}

/** The pipeline's security record in the truth's terms (names, IMO, UN/LOCODEs). */
export type PredictedSecurity = TruthSecurityQuote;

export interface SecurityGrade {
  /** The stored record in truth terms; null when the pipeline stored none. */
  predicted: PredictedSecurity | null;
  /** Empty for a truth-needs_review case the pipeline did not store (see the module comment). */
  fields: SecurityFieldGrade[];
  /** Every critical field correct; null when no field was graded. */
  criticalAllCorrect: boolean | null;
}

export function securityToTruthSpace(r: SecurityRecord, keys: EntityKeys): PredictedSecurity {
  const name = (id: Id) => keys.providerName?.(id) ?? `unknown provider id ${id}`;
  return {
    provider: name(r.providerId),
    vesselImo: r.vesselImo,
    embarkUnlocode: code(r.embarkPortId, keys.portUnlocode),
    disembarkUnlocode: code(r.disembarkPortId, keys.portUnlocode),
    teamSize: r.teamSize,
    dayRate: r.dayRate,
    currency: r.currency,
    fixedFees: r.fixedFees,
    minDays: r.minDays,
    validUntil: r.validUntil,
  };
}

function gradeSecurityFields(
  t: TruthSecurityQuote,
  p: PredictedSecurity | null,
): SecurityFieldGrade[] {
  const out: SecurityFieldGrade[] = [];
  const add = <T extends string | number>(
    field: SecurityField,
    tv: T | null,
    pv: T | null,
    equal: (a: T, b: T) => boolean,
  ) =>
    out.push({
      field,
      critical: isSecurityCritical(field),
      verdict: verdictOf(tv, pv, equal),
      truth: tv,
      predicted: pv,
    });
  add("provider", t.provider, p?.provider ?? null, same);
  add("vessel", t.vesselImo, p?.vesselImo ?? null, same);
  add("embarkPort", t.embarkUnlocode, p?.embarkUnlocode ?? null, same);
  add("disembarkPort", t.disembarkUnlocode, p?.disembarkUnlocode ?? null, same);
  add("teamSize", t.teamSize, p?.teamSize ?? null, same);
  add("dayRate", t.dayRate, p?.dayRate ?? null, sameCent);
  add("currency", t.currency, p?.currency ?? null, same);
  add("fixedFees", t.fixedFees, p?.fixedFees ?? null, sameCent);
  add("minDays", t.minDays, p?.minDays ?? null, same);
  add("validUntil", t.validUntil, p?.validUntil ?? null, same);
  return out;
}

/** See the module comment. Null when the truth is not a security quote. */
export function gradeSecurity(
  truth: ExtractionTruth,
  outcome: CaseOutcome,
  keys: EntityKeys,
): SecurityGrade | null {
  const e = truth.expected;
  if (e.kind !== "security_quote") return null;
  const record = outcome.status === "extracted" ? (outcome.security ?? null) : null;
  const predicted = record === null ? null : securityToTruthSpace(record, keys);
  const graded = e.security != null && (e.status === "extracted" || predicted !== null);
  const fields = graded && e.security ? gradeSecurityFields(e.security, predicted) : [];
  return {
    predicted,
    fields,
    criticalAllCorrect:
      fields.length === 0 ? null : fields.every((f) => !f.critical || f.verdict === "correct"),
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
  /**
   * Stored as extracted although the truth is not a clean quote, or a critical field, the barge
   * fee or the supplier is wrong or missing.
   */
  unsafeAutoAccept: boolean | null;
  /** Truth extracted, pipeline anything else. */
  falseReview: boolean | null;
  /** Truth needs_review only: at least one of `truth.expected.reviewChecks` failed. */
  reviewCheckMatched: boolean | null;
  /** Track 3: the security grade of a truth security quote; null (or absent) otherwise. */
  security?: SecurityGrade | null;
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
      security: null,
    };
  }

  const predicted = outcome.normalised === null ? null : toTruthSpace(outcome.normalised, keys);
  const security = gradeSecurity(truth, outcome, keys);
  const graded =
    e.kind === "quote" && e.quote !== null
      ? gradeFields(e.quote, predicted ?? toTruthSpace(EMPTY_VIEW, keys))
      : { fields: [], lines: [] };
  const criticalOff = graded.fields.some((f) => f.critical && f.verdict !== "correct");
  const unsafeOff = graded.fields.some(
    (f) => UNSAFE_IF_OFF.has(f.field) && f.verdict !== "correct",
  );
  const extracted = outcome.status === "extracted";
  // A stored security quote is unsafe unless the truth is a clean security quote, the model read
  // it as one, and every critical value and the provider are right.
  const securityUnsafe =
    security === null ||
    outcome.kind !== "security_quote" ||
    e.status !== "extracted" ||
    security.fields.some((f) => SECURITY_UNSAFE_IF_OFF.has(f.field) && f.verdict !== "correct");
  return {
    ...base,
    error: null,
    failure: outcome.status === "failed" ? (outcome.error ?? "failed without a message") : null,
    fields: graded.fields,
    lines: graded.lines,
    predicted,
    criticalAllCorrect: e.kind === "quote" && e.quote !== null ? !criticalOff : null,
    unsafeAutoAccept:
      extracted &&
      (e.kind === "security_quote"
        ? securityUnsafe
        : e.kind !== "quote" || e.status !== "extracted" || unsafeOff),
    falseReview: e.status === "extracted" && !extracted,
    reviewCheckMatched:
      e.status === "needs_review"
        ? e.reviewChecks.some((c) => outcome.failedChecks.includes(c))
        : null,
    security,
  };
}
