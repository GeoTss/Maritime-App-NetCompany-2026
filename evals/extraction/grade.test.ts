import type { ExtractionTruth, NormalisedView, TruthSecurityQuote } from "@pharos/shared";
import { describe, expect, it } from "vitest";
import {
  alignLines,
  type CaseOutcome,
  type EntityKeys,
  entityKeys,
  type FieldGrade,
  gradeCase,
  SECURITY_GRADED_FIELDS,
  type SecurityField,
  type SecurityRecord,
  securityToTruthSpace,
} from "./grade.js";
import { evalWorld } from "./world.js";

/** Ids 1, 2, 3 stand for the vessel / port / supplier the truth names; anything else is unknown. */
const KEYS: EntityKeys = {
  vesselImo: (id) => ({ 1: "9480019", 2: "9485069" })[id] ?? null,
  portUnlocode: (id) => ({ 1: "MTMAR", 2: "GIGIB" })[id] ?? null,
  supplierKey: (id) => ({ 1: "kestrel", 2: "straitline" })[id] ?? null,
};

const truth = (over: Partial<ExtractionTruth["expected"]> = {}): ExtractionTruth => ({
  id: "case-1",
  tags: ["plain"],
  source: "generated",
  expected: {
    kind: "quote",
    status: "extracted",
    reviewChecks: [],
    quote: {
      vesselImo: "9480019",
      portUnlocode: "MTMAR",
      supplierKey: "kestrel",
      currency: "USD",
      validUntil: "2026-11-16",
      deliveryFrom: "2026-11-20",
      deliveryTo: "2026-11-22",
      bargeFee: 2800,
      lines: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 738.5 }],
    },
    ...over,
  },
});

/** The normalised view that matches `truth()` exactly. */
const view = (over: Partial<NormalisedView> = {}): NormalisedView => ({
  vesselId: 1,
  portId: 1,
  supplierId: 1,
  currency: "USD",
  validUntil: "2026-11-16",
  deliveryFrom: "2026-11-20",
  deliveryTo: "2026-11-22",
  bargeFee: 2800,
  lines: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 738.5 }],
  ...over,
});

const outcome = (over: Partial<CaseOutcome> = {}): CaseOutcome => ({
  status: "extracted",
  kind: "quote",
  normalised: view(),
  error: null,
  errorKind: null,
  failedChecks: [],
  ...over,
});

const field = (fields: FieldGrade[], path: string) => fields.find((f) => f.path === path)?.verdict;

describe("gradeCase: field comparison (type-aware)", () => {
  it.each<[string, Partial<NormalisedView>, string, "correct" | "wrong" | "missing"]>([
    ["exact match", {}, "lines.0.price", "correct"],
    [
      "price within half a cent",
      { lines: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 738.504 }] },
      "lines.0.price",
      "correct",
    ],
    [
      "price off by a cent",
      { lines: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 738.51 }] },
      "lines.0.price",
      "wrong",
    ],
    [
      "price null",
      { lines: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: null }] },
      "lines.0.price",
      "missing",
    ],
    [
      "quantity exact only",
      { lines: [{ grade: "LSMGO", qtyMt: 300.001, pricePerMt: 738.5 }] },
      "lines.0.quantity",
      "wrong",
    ],
    [
      "grade differs",
      { lines: [{ grade: "VLSFO", qtyMt: 300, pricePerMt: 738.5 }] },
      "lines.0.grade",
      "wrong",
    ],
    ["date differs by a day", { validUntil: "2026-11-17" }, "validUntil", "wrong"],
    ["date null", { deliveryFrom: null }, "deliveryFrom", "missing"],
    ["vessel resolved to another IMO", { vesselId: 2 }, "vessel", "wrong"],
    ["vessel id unknown to the world is wrong, not missing", { vesselId: 99 }, "vessel", "wrong"],
    ["port unresolved", { portId: null }, "port", "missing"],
    ["supplier resolved to another key", { supplierId: 2 }, "supplier", "wrong"],
    ["currency differs", { currency: "EUR" }, "currency", "wrong"],
    ["barge fee to the cent", { bargeFee: 2800.004 }, "bargeFee", "correct"],
    ["barge fee differs", { bargeFee: 2900 }, "bargeFee", "wrong"],
  ])("%s", (_name, over, path, verdict) => {
    const g = gradeCase(truth(), outcome({ normalised: view(over) }), KEYS);
    expect(field(g.fields, path)).toBe(verdict);
  });

  it("both null is correct; truth null with a value is wrong", () => {
    const t = truth();
    if (!t.expected.quote) throw new Error("fixture");
    t.expected.quote.validUntil = null;
    expect(
      field(
        gradeCase(t, outcome({ normalised: view({ validUntil: null }) }), KEYS).fields,
        "validUntil",
      ),
    ).toBe("correct");
    expect(field(gradeCase(t, outcome(), KEYS).fields, "validUntil")).toBe("wrong");
  });

  it("grades every field of every line and marks the critical ones", () => {
    const g = gradeCase(truth(), outcome(), KEYS);
    expect(g.fields.map((f) => [f.path, f.critical, f.verdict])).toEqual([
      ["vessel", true, "correct"],
      ["port", true, "correct"],
      ["supplier", false, "correct"],
      ["currency", true, "correct"],
      ["validUntil", true, "correct"],
      ["deliveryFrom", true, "correct"],
      ["deliveryTo", true, "correct"],
      ["bargeFee", false, "correct"],
      ["lines.0.grade", true, "correct"],
      ["lines.0.quantity", true, "correct"],
      ["lines.0.price", true, "correct"],
    ]);
    expect(g.criticalAllCorrect).toBe(true);
    expect(g.predicted?.vesselImo).toBe("9480019");
  });

  it("a not-a-quote answer or no output leaves every truth field missing", () => {
    for (const normalised of [
      null,
      view({
        vesselId: null,
        portId: null,
        supplierId: null,
        currency: null,
        validUntil: null,
        deliveryFrom: null,
        deliveryTo: null,
        bargeFee: null,
        lines: [],
      }),
    ]) {
      const g = gradeCase(
        truth(),
        outcome({ status: "not_a_quote", kind: "not_a_quote", normalised }),
        KEYS,
      );
      expect(new Set(g.fields.map((f) => f.verdict))).toEqual(new Set(["missing"]));
      expect(g.criticalAllCorrect).toBe(false);
    }
  });
});

describe("alignLines (by grade when both sides have one, otherwise in order)", () => {
  it("pairs equal grades across positions", () => {
    expect(
      alignLines(
        [{ grade: "LSMGO" }, { grade: "VLSFO" }],
        [{ grade: "VLSFO" }, { grade: "LSMGO" }],
      ),
    ).toEqual([
      { truth: 0, predicted: 1 },
      { truth: 1, predicted: 0 },
    ]);
  });

  it("pairs the lines left after grade matching in order, so a wrong grade is one wrong field", () => {
    expect(
      alignLines([{ grade: "LSMGO" }, { grade: "VLSFO" }], [{ grade: "VLSFO" }, { grade: "HSFO" }]),
    ).toEqual([
      { truth: 0, predicted: 1 },
      { truth: 1, predicted: 0 },
    ]);
    expect(alignLines([{ grade: "VLSFO" }], [{ grade: null }])).toEqual([
      { truth: 0, predicted: 0 },
    ]);
  });

  it("leaves extra truth lines unpaired (missing) and extra predicted lines unpaired (wrong)", () => {
    expect(alignLines([{ grade: "LSMGO" }, { grade: "VLSFO" }], [{ grade: "VLSFO" }])).toEqual([
      { truth: 0, predicted: null },
      { truth: 1, predicted: 0 },
    ]);
    expect(alignLines([{ grade: "LSMGO" }], [{ grade: "LSMGO" }, { grade: "LSMGO" }])).toEqual([
      { truth: 0, predicted: 0 },
      { truth: null, predicted: 1 },
    ]);
  });

  const extraLine = (line: {
    grade: "VLSFO" | null;
    qtyMt: number | null;
    pricePerMt: number | null;
  }) =>
    gradeCase(
      truth(),
      outcome({
        normalised: view({ lines: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 738.5 }, line] }),
      }),
      KEYS,
    );
  const extraVerdicts = (g: ReturnType<typeof gradeCase>) =>
    g.fields.filter((f) => f.path.startsWith("lines.extra.1.")).map((f) => [f.field, f.verdict]);

  it("an extra predicted line's values are graded against null: each value is wrong", () => {
    const g = extraLine({ grade: "VLSFO", qtyMt: 200, pricePerMt: 600 });
    expect(extraVerdicts(g)).toEqual([
      ["grade", "wrong"],
      ["quantity", "wrong"],
      ["price", "wrong"],
    ]);
    expect(g.unsafeAutoAccept).toBe(true);
  });

  it("an extra predicted line's null fields are correct (both null), its values wrong", () => {
    expect(extraVerdicts(extraLine({ grade: null, qtyMt: null, pricePerMt: null }))).toEqual([
      ["grade", "correct"],
      ["quantity", "correct"],
      ["price", "correct"],
    ]);
    const partial = extraLine({ grade: null, qtyMt: 200, pricePerMt: null });
    expect(extraVerdicts(partial)).toEqual([
      ["grade", "correct"],
      ["quantity", "wrong"],
      ["price", "correct"],
    ]);
    expect(partial.unsafeAutoAccept).toBe(true);
    expect(partial.criticalAllCorrect).toBe(false);
  });

  it("a multi-grade quote in another order grades as correct", () => {
    const t = truth();
    if (!t.expected.quote) throw new Error("fixture");
    t.expected.quote.lines = [
      { grade: "LSMGO", qtyMt: 300, pricePerMt: 738.5 },
      { grade: "VLSFO", qtyMt: 500, pricePerMt: 612.25 },
    ];
    const g = gradeCase(
      t,
      outcome({
        normalised: view({
          lines: [
            { grade: "VLSFO", qtyMt: 500, pricePerMt: 612.25 },
            { grade: "LSMGO", qtyMt: 300, pricePerMt: 738.5 },
          ],
        }),
      }),
      KEYS,
    );
    expect(g.criticalAllCorrect).toBe(true);
    expect(g.unsafeAutoAccept).toBe(false);
  });
});

describe("gradeCase: unsafe auto-accept, false review, review check", () => {
  const review = (checks: string[]) => truth({ status: "needs_review", reviewChecks: checks });

  it.each<[string, ExtractionTruth, Partial<CaseOutcome>, boolean]>([
    ["correct and extracted: safe", truth(), {}, false],
    [
      "a wrong critical value extracted: unsafe",
      truth(),
      { normalised: view({ currency: "EUR" }) },
      true,
    ],
    [
      "a missing critical value extracted: unsafe",
      truth(),
      { normalised: view({ deliveryTo: null }) },
      true,
    ],
    // I6 (user decision 2026-11-14, "Count them as unsafe"): the stored barge fee and supplier
    // decide what is paid and to whom, so either wrong or missing on an extracted case is unsafe.
    ["a wrong barge fee extracted: unsafe", truth(), { normalised: view({ bargeFee: 1 }) }, true],
    [
      "a missing barge fee extracted: unsafe",
      truth(),
      { normalised: view({ bargeFee: null }) },
      true,
    ],
    ["a wrong supplier extracted: unsafe", truth(), { normalised: view({ supplierId: 2 }) }, true],
    [
      "a missing supplier extracted: unsafe",
      truth(),
      { normalised: view({ supplierId: null }) },
      true,
    ],
    [
      "a wrong barge fee sent to review: safe",
      truth(),
      { status: "needs_review", normalised: view({ bargeFee: 1 }) },
      false,
    ],
    [
      "a wrong critical value sent to review: safe",
      truth(),
      { status: "needs_review", normalised: view({ currency: "EUR" }) },
      false,
    ],
    // The named grader-table case: the values look right, but the truth says this must be reviewed.
    ["unsafe auto-accept counts truth-review cases", review(["validity_not_expired"]), {}, true],
    [
      "truth not a quote, extracted: unsafe",
      { ...truth({ kind: "not_a_quote", status: "not_a_quote", quote: null }) },
      {},
      true,
    ],
    [
      "truth needs review with no determinable quote, extracted: unsafe",
      truth({ status: "needs_review", reviewChecks: ["quantity_unambiguous"], quote: null }),
      {},
      true,
    ],
  ])("%s", (_name, t, over, unsafe) => {
    expect(gradeCase(t, outcome(over), KEYS).unsafeAutoAccept).toBe(unsafe);
  });

  it("a wrong barge fee or supplier is unsafe but leaves critical-field accuracy alone", () => {
    for (const over of [{ bargeFee: 1 }, { supplierId: 2 }, { supplierId: null }]) {
      const g = gradeCase(truth(), outcome({ normalised: view(over) }), KEYS);
      expect(g.unsafeAutoAccept, JSON.stringify(over)).toBe(true);
      expect(g.criticalAllCorrect, JSON.stringify(over)).toBe(true);
      expect(g.fields.filter((f) => f.verdict !== "correct").every((f) => !f.critical)).toBe(true);
    }
  });

  it("false review: truth extracted, pipeline did anything else", () => {
    expect(gradeCase(truth(), outcome(), KEYS).falseReview).toBe(false);
    for (const status of ["needs_review", "failed", "not_a_quote"] as const) {
      expect(gradeCase(truth(), outcome({ status }), KEYS).falseReview).toBe(true);
    }
    const t = truth({ status: "needs_review", reviewChecks: ["vessel_resolved"] });
    expect(gradeCase(t, outcome({ status: "needs_review" }), KEYS).falseReview).toBe(false);
  });

  it("review check matched: one of the truth's review checks failed (truth needs_review only)", () => {
    const t = truth({
      status: "needs_review",
      reviewChecks: ["vessel_resolved", "requirement_found"],
    });
    const g = (failedChecks: string[]) =>
      gradeCase(t, outcome({ status: "needs_review", failedChecks }), KEYS).reviewCheckMatched;
    expect(g(["requirement_found", "price_within_band"])).toBe(true);
    expect(g(["price_within_band"])).toBe(false);
    expect(gradeCase(truth(), outcome(), KEYS).reviewCheckMatched).toBeNull();
  });

  it("a truth not-a-quote has no fields to grade", () => {
    const g = gradeCase(
      truth({ kind: "not_a_quote", status: "not_a_quote", quote: null }),
      outcome({ status: "not_a_quote", kind: "not_a_quote", normalised: null }),
      KEYS,
    );
    expect(g.fields).toEqual([]);
    expect(g.criticalAllCorrect).toBeNull();
    expect(g.unsafeAutoAccept).toBe(false);
  });
});

describe("gradeCase: errors are not wrong answers", () => {
  it("an API error, truncation, refusal or replay miss grades nothing", () => {
    for (const errorKind of ["api_error", "truncation", "refusal", "replay_miss"] as const) {
      const g = gradeCase(
        truth(),
        outcome({ status: "failed", kind: null, normalised: null, error: "boom", errorKind }),
        KEYS,
      );
      expect(g.error).toEqual({ kind: errorKind, message: "boom" });
      expect(g.fields).toEqual([]);
      expect([g.unsafeAutoAccept, g.falseReview, g.criticalAllCorrect]).toEqual([null, null, null]);
    }
  });

  it("any other failure is graded (status failed, nothing extracted) and its message kept", () => {
    const g = gradeCase(
      truth(),
      outcome({
        status: "failed",
        kind: null,
        normalised: null,
        error: "Unusable extraction output: x",
      }),
      KEYS,
    );
    expect(g.error).toBeNull();
    expect(g.failure).toBe("Unusable extraction output: x");
    expect(g.falseReview).toBe(true);
    expect(g.unsafeAutoAccept).toBe(false);
    expect(new Set(g.fields.map((f) => f.verdict))).toEqual(new Set(["missing"]));
  });
});

describe("entityKeys", () => {
  it("maps world ids to the truth's IMO, UN/LOCODE and supplier key", () => {
    const world = evalWorld();
    const keys = entityKeys(world);
    const v = world.vessels[0];
    const p = world.ports[0];
    if (!v || !p) throw new Error("empty world");
    expect(keys.vesselImo(v.id)).toBe(v.imo);
    expect(keys.portUnlocode(p.id)).toBe(p.unlocode);
    const kestrel = world.suppliers.find((s) => s.name === "Kestrel Marine Fuels");
    expect(kestrel && keys.supplierKey(kestrel.id)).toBe("kestrel");
    expect(keys.vesselImo(999_999)).toBeNull();
  });
});

// ---------- Track 3 security quotes ----------

const SEC_KEYS: EntityKeys = {
  ...KEYS,
  portUnlocode: (id) => ({ 13: "AEFJR", 15: "DJJIB" })[id] ?? null,
  providerName: (id) => ({ 1: "Tridentis Marine Protection" })[id] ?? null,
};

const securityTruth = (over: Partial<ExtractionTruth["expected"]> = {}): ExtractionTruth => ({
  id: "security-plain-001",
  tags: ["security-plain"],
  source: "generated",
  expected: {
    kind: "security_quote",
    status: "extracted",
    reviewChecks: [],
    quote: null,
    security: {
      provider: "Tridentis Marine Protection",
      vesselImo: "9485069",
      embarkUnlocode: "AEFJR",
      disembarkUnlocode: "DJJIB",
      teamSize: 4,
      dayRate: 1250,
      currency: "USD",
      fixedFees: 6000,
      minDays: 4,
      validUntil: "2026-11-20",
    },
    ...over,
  },
});

/** The pipeline's record that matches `securityTruth()` exactly. */
const record = (over: Partial<SecurityRecord> = {}): SecurityRecord => ({
  providerId: 1,
  vesselImo: "9485069",
  embarkPortId: 13,
  disembarkPortId: 15,
  teamSize: 4,
  dayRate: 1250,
  fixedFees: 6000,
  minDays: 4,
  currency: "USD",
  validUntil: "2026-11-20",
  ...over,
});

const secOutcome = (over: Partial<CaseOutcome> = {}): CaseOutcome => ({
  status: "extracted",
  kind: "security_quote",
  normalised: view({
    vesselId: null,
    portId: null,
    supplierId: null,
    currency: null,
    validUntil: null,
    deliveryFrom: null,
    deliveryTo: null,
    bargeFee: null,
    lines: [],
  }),
  security: record(),
  error: null,
  errorKind: null,
  failedChecks: [],
  ...over,
});

const secVerdict = (g: ReturnType<typeof gradeCase>, f: SecurityField) =>
  g.security?.fields.find((x) => x.field === f)?.verdict;

describe("gradeCase: security quotes (Track 3)", () => {
  it("known-good: the stored record equal to the truth is all correct, safe, critical all correct", () => {
    const g = gradeCase(securityTruth(), secOutcome(), SEC_KEYS);
    expect(g.security?.fields.map((f) => f.field)).toEqual([...SECURITY_GRADED_FIELDS]);
    expect(new Set(g.security?.fields.map((f) => f.verdict))).toEqual(new Set(["correct"]));
    expect(g.security?.criticalAllCorrect).toBe(true);
    expect(g.unsafeAutoAccept).toBe(false);
    expect(g.falseReview).toBe(false);
    // The fuel side is not graded for a security truth.
    expect(g.fields).toEqual([]);
    expect(g.criticalAllCorrect).toBeNull();
    expect(g.security?.predicted).toEqual(securityTruth().expected.security);
  });

  it.each<[string, Partial<SecurityRecord>, SecurityField, "correct" | "wrong"]>([
    ["day rate within half a cent", { dayRate: 1250.004 }, "dayRate", "correct"],
    ["day rate one dollar off", { dayRate: 1249 }, "dayRate", "wrong"],
    ["fixed fees: the first of several charges", { fixedFees: 1500 }, "fixedFees", "wrong"],
    ["team of 6, not 4", { teamSize: 6 }, "teamSize", "wrong"],
    ["minimum read as 0 (fees left out)", { minDays: 0 }, "minDays", "wrong"],
    ["EUR, not USD", { currency: "EUR" }, "currency", "wrong"],
    ["another disembark port", { disembarkPortId: 13 }, "disembarkPort", "wrong"],
    ["an id the world cannot name", { embarkPortId: 99 }, "embarkPort", "wrong"],
    ["validity a day late", { validUntil: "2026-11-21" }, "validUntil", "wrong"],
    ["another provider", { providerId: 2 }, "provider", "wrong"],
  ])("known-bad: %s", (_, over, f, verdict) => {
    const g = gradeCase(securityTruth(), secOutcome({ security: record(over) }), SEC_KEYS);
    expect(secVerdict(g, f)).toBe(verdict);
    // Any critical value or the provider off on a stored quote makes it unsafe.
    expect(g.unsafeAutoAccept).toBe(verdict === "wrong");
    if (f !== "provider") expect(g.security?.criticalAllCorrect).toBe(verdict === "correct");
  });

  it("a truth-extracted case sent to review has every field missing and is a false review", () => {
    const g = gradeCase(
      securityTruth(),
      secOutcome({ status: "needs_review", security: null, failedChecks: ["amounts_parsed"] }),
      SEC_KEYS,
    );
    expect(new Set(g.security?.fields.map((f) => f.verdict))).toEqual(new Set(["missing"]));
    expect(g.falseReview).toBe(true);
    expect(g.unsafeAutoAccept).toBe(false);
  });

  it("a truth-needs_review case sent to review grades no field and matches its check", () => {
    const t = securityTruth({
      status: "needs_review",
      reviewChecks: ["team_size_unambiguous"],
      security: { ...(securityTruth().expected.security as TruthSecurityQuote), teamSize: null },
    });
    const g = gradeCase(
      t,
      secOutcome({
        status: "needs_review",
        security: null,
        failedChecks: ["team_size_unambiguous"],
      }),
      SEC_KEYS,
    );
    expect(g.security?.fields).toEqual([]);
    expect(g.security?.criticalAllCorrect).toBeNull();
    expect(g.reviewCheckMatched).toBe(true);
    expect(g.unsafeAutoAccept).toBe(false);
  });

  it("known-bad: '4/6 guards' stored as 4 is an unsafe auto-accept with the team size wrong", () => {
    const t = securityTruth({
      status: "needs_review",
      reviewChecks: ["team_size_unambiguous"],
      security: { ...(securityTruth().expected.security as TruthSecurityQuote), teamSize: null },
    });
    const g = gradeCase(t, secOutcome(), SEC_KEYS);
    expect(secVerdict(g, "teamSize")).toBe("wrong");
    expect(secVerdict(g, "dayRate")).toBe("correct");
    expect(g.unsafeAutoAccept).toBe(true);
    expect(g.reviewCheckMatched).toBe(false);
  });

  it("kind confusion either way is unsafe when stored", () => {
    // A security email stored as a fuel quote: no security record, so every field is missing.
    const asFuel = gradeCase(securityTruth(), outcome({ kind: "quote", security: null }), SEC_KEYS);
    expect(asFuel.unsafeAutoAccept).toBe(true);
    expect(new Set(asFuel.security?.fields.map((f) => f.verdict))).toEqual(new Set(["missing"]));
    // A fuel email stored as a security quote: the fuel fields are missing.
    const asSecurity = gradeCase(truth(), secOutcome(), KEYS);
    expect(asSecurity.unsafeAutoAccept).toBe(true);
    expect(asSecurity.security).toBeNull();
    // A not-a-quote email stored as a security quote.
    const naq = gradeCase(
      truth({ kind: "not_a_quote", status: "not_a_quote", quote: null }),
      secOutcome(),
      KEYS,
    );
    expect(naq.unsafeAutoAccept).toBe(true);
  });

  it("an API error grades nothing, security included", () => {
    const g = gradeCase(
      securityTruth(),
      secOutcome({ status: "failed", errorKind: "api_error", error: "529", security: null }),
      SEC_KEYS,
    );
    expect(g.error).toEqual({ kind: "api_error", message: "529" });
    expect(g.security).toBeNull();
    expect(g.unsafeAutoAccept).toBeNull();
  });

  it("entityKeys names the seeded security providers", () => {
    const world = evalWorld();
    const keys = entityKeys(world);
    const tri = world.securityProviders.find((p) => p.name === "Tridentis Marine Protection");
    expect(tri && keys.providerName?.(tri.id)).toBe("Tridentis Marine Protection");
    expect(keys.providerName?.(999)).toBeNull();
    expect(securityToTruthSpace(record({ providerId: 999 }), keys).provider).toBe(
      "unknown provider id 999",
    );
  });
});
