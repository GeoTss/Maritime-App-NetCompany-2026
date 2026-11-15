import { describe, expect, it } from "vitest";
import {
  AisObservation,
  AskEvent,
  AskResponse,
  AskResult,
  CalculateInput,
  ConsumptionCurve,
  DraftedMessage,
  EmissionsInput,
  ErpOrderRequest,
  ExtractionOutput,
  ExtractionTruth,
  GradeAmounts,
  ListFleetInput,
  ListQuotesInput,
  LlmCall,
  NormalisedView,
  PlanBunkeringInput,
  PlanRouteSpeedInput,
  ProposeActionInput,
  ProposedAction,
  Provenance,
  QA_CATEGORIES,
  QaTruth,
  RecommendationStatus,
  RecommendationView,
  ReviewCorrection,
  RouteLeg,
  RouteSpeedInput,
  VesselStatusInput,
  WeatherGrid,
} from "./index.js";

const text = (value: string | null, evidence: string | null = value) => ({ value, evidence });
const date = (asWritten: string | null) => ({ asWritten, evidence: asWritten });
const money = (value: number | null, currency: string | null, perUnit: string | null) => ({
  value,
  currency,
  perUnit,
  asWritten: value === null ? null : `${currency}${value}`,
  evidence: value === null ? null : `Price ${currency}${value} ${perUnit}`,
});

const quote = {
  kind: "quote",
  supplierName: text("Nordwind Bunker Services"),
  vesselName: text("MV Aegean Pioneer"),
  vesselImo: text(null),
  port: text("Algeciras"),
  deliveryFrom: date("18 Nov"),
  deliveryTo: date(null),
  validUntil: date("valid until 16:00 CET today"),
  bargeFee: money(3000, "€", "lump sum"),
  lines: [
    {
      grade: text("LSMGO 0.1%S"),
      quantity: {
        value: null,
        unit: "mt",
        asWritten: "300/350 mt",
        evidence: "We can offer 300/350 mt LSMGO.",
      },
      price: money(690, "€", "pmt"),
    },
  ],
  notes: null,
};

describe("ExtractionOutput", () => {
  it("accepts a quote with null fields but valid shape", () => {
    const parsed = ExtractionOutput.parse(quote);
    expect(parsed.kind).toBe("quote");
    if (parsed.kind === "quote") {
      expect(parsed.lines[0]?.quantity.value).toBeNull();
      expect(parsed.bargeFee.currency).toBe("€");
    }
  });

  it("rejects a quote with no lines", () => {
    expect(ExtractionOutput.safeParse({ ...quote, lines: [] }).success).toBe(false);
  });

  it("rejects an unknown key", () => {
    expect(ExtractionOutput.safeParse({ ...quote, totalUsd: 207000 }).success).toBe(false);
  });

  it("rejects an omitted field instead of treating it as null", () => {
    const { notes: _notes, ...withoutNotes } = quote;
    expect(ExtractionOutput.safeParse(withoutNotes).success).toBe(false);
  });

  it("parses not_a_quote", () => {
    const parsed = ExtractionOutput.parse({
      kind: "not_a_quote",
      reason: "Port agent's arrival notice, no prices",
      evidence: "Please find attached the arrival notice.",
    });
    expect(parsed.kind).toBe("not_a_quote");
  });
});

describe("ProposedAction", () => {
  const action = {
    type: "purchase_order",
    calculationId: 1,
    optionId: "o1",
    factRefs: ["f_a"],
    rationale: "lowest total cost",
  };

  it("accepts a reference to a stored calculation", () => {
    expect(ProposedAction.parse(action).type).toBe("purchase_order");
  });

  it("rejects a model-typed quantity", () => {
    expect(ProposedAction.safeParse({ ...action, qtyMt: 300 }).success).toBe(false);
  });

  it("rejects a proposal with no cited facts", () => {
    expect(ProposedAction.safeParse({ ...action, factRefs: [] }).success).toBe(false);
  });
});

describe("Provenance", () => {
  it("discriminates on source", () => {
    expect(
      Provenance.parse({ source: "db", table: "noon_reports", rowId: 4, field: "robMt.LSMGO" })
        .source,
    ).toBe("db");
    expect(Provenance.safeParse({ source: "db", table: "noon_reports", rowId: 4 }).success).toBe(
      false,
    );
    expect(
      Provenance.safeParse({ source: "derived", operation: "subtract", operands: [] }).success,
    ).toBe(false);
    expect(
      Provenance.safeParse({ source: "derived", operation: "subtract", operands: ["f_a", "f_b"] })
        .success,
    ).toBe(true);
  });
});

describe("domain primitives", () => {
  it("GradeAmounts rejects negative mt", () => {
    expect(GradeAmounts.safeParse({ LSMGO: -1, VLSFO: 0, HSFO: 0 }).success).toBe(false);
  });

  it("RouteLeg rejects an ETS coverage that is not 0, 0.5 or 1", () => {
    const leg = {
      id: 1,
      fromPortId: 1,
      toPortId: 2,
      distanceNm: 100,
      requiredGrade: "LSMGO",
      etsCoverage: 0.5,
      waypoints: [
        { lat: 31.26, lon: 32.31 },
        { lat: 35.82, lon: 14.54 },
      ],
    };
    expect(RouteLeg.safeParse(leg).success).toBe(true);
    expect(RouteLeg.safeParse({ ...leg, etsCoverage: 0.7 }).success).toBe(false);
  });

  it("ConsumptionCurve rejects maxSpeedKn < minSpeedKn", () => {
    const curve = {
      refSpeedKn: 13,
      refMtPerDay: 30,
      auxMtPerDay: 2.5,
      minSpeedKn: 8,
      maxSpeedKn: 16,
    };
    expect(ConsumptionCurve.safeParse(curve).success).toBe(true);
    expect(ConsumptionCurve.safeParse({ ...curve, maxSpeedKn: 7 }).success).toBe(false);
  });
});

describe("Phase 2 contracts", () => {
  it("AskResult (inside the API) carries a withheld answer with the failing numbers", () => {
    const r = AskResult.parse({
      conversationId: 1,
      messageId: 2,
      answer: null,
      facts: [],
      gate: {
        passed: false,
        repaired: true,
        ungroundedNumbers: ["8,000"],
        attempts: [
          { attempt: 1, passed: false, ungroundedNumbers: ["8,000"] },
          { attempt: 2, passed: false, ungroundedNumbers: ["8,000"] },
        ],
      },
      recommendationIds: [],
      llmCallIds: [3, 4],
    });
    expect(r.answer).toBeNull();
    expect(r.gate.ungroundedNumbers).toEqual(["8,000"]);
  });

  const order = {
    supplierErpCode: "SUP-KES",
    vesselImo: "9876547",
    port: "MTMLA",
    currency: "USD",
    lines: [{ grade: "LSMGO", qtyMt: 300, pricePerMt: 738 }],
    bargeFee: 2800,
    reference: "rec-1",
  };

  it("ErpOrderRequest accepts an order and rejects empty lines or a zero quantity", () => {
    expect(ErpOrderRequest.safeParse(order).success).toBe(true);
    expect(ErpOrderRequest.safeParse({ ...order, lines: [] }).success).toBe(false);
    expect(
      ErpOrderRequest.safeParse({
        ...order,
        lines: [{ grade: "LSMGO", qtyMt: 0, pricePerMt: 738 }],
      }).success,
    ).toBe(false);
  });

  it("RecommendationView carries the proposing answer's gate and the order's ERP state", () => {
    const rec = {
      id: 1,
      type: "purchase_order",
      status: "executed",
      calculationId: 7,
      optionId: "MTMLA-kestrel",
      summary: "Order LSMGO from Kestrel Marine Fuels at Marsaxlokk.",
      expectedSavingUsd: 16171.54,
      factRefs: ["f_plan_bunkering_7_bestOptionId"],
      facts: [],
      gatePassed: false,
      order: { orderId: 3, erpPoNumber: "PO-000001", erpSyncStatus: "synced" },
    };
    expect(RecommendationView.parse(rec).order?.erpPoNumber).toBe("PO-000001");
    // Not made by an ask, not approved yet.
    expect(RecommendationView.safeParse({ ...rec, gatePassed: null, order: null }).success).toBe(
      true,
    );
    const approvedUnsynced = { orderId: 3, erpPoNumber: null, erpSyncStatus: "failed" };
    expect(RecommendationView.safeParse({ ...rec, order: approvedUnsynced }).success).toBe(true);
    const { gatePassed: _g, ...noGate } = rec;
    expect(RecommendationView.safeParse(noGate).success).toBe(false);
    const { order: _o, ...noOrder } = rec;
    expect(RecommendationView.safeParse(noOrder).success).toBe(false);
    expect(
      RecommendationView.safeParse({ ...rec, order: { ...rec.order, erpSyncStatus: "sent" } })
        .success,
    ).toBe(false);
  });

  it("LlmCall rejects negative token counts", () => {
    const call = {
      id: 1,
      purpose: "extract",
      model: "claude-haiku-5-5",
      mode: "live",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: 1500,
      costUsd: 0.00035,
      stopReason: "end_turn",
      requestKey: "abc",
      documentId: null,
      conversationId: null,
      createdAt: new Date("2026-11-14T08:00:00Z"),
    };
    expect(LlmCall.safeParse(call).success).toBe(true);
    expect(LlmCall.safeParse({ ...call, outputTokens: -1 }).success).toBe(false);
  });
});

describe("extraction truth and review contracts", () => {
  const truthQuote = {
    vesselImo: "9123456",
    portUnlocode: "ESALG",
    supplierKey: "nordwind",
    currency: "USD",
    validUntil: "2026-11-20",
    deliveryFrom: "2026-11-18",
    deliveryTo: "2026-11-19",
    bargeFee: 500,
    lines: [{ grade: "VLSFO", qtyMt: 800, pricePerMt: 612.5 }],
  };
  const truth = {
    id: "gen-001",
    tags: ["clean"],
    source: "generated",
    expected: { kind: "quote", status: "extracted", reviewChecks: [], quote: truthQuote },
  };
  const withExpected = (patch: object) => ({
    ...truth,
    expected: { ...truth.expected, ...patch },
  });

  it("parses a valid generated truth", () => {
    expect(ExtractionTruth.safeParse(truth).success).toBe(true);
  });

  it("rejects needs_review without reviewChecks", () => {
    expect(ExtractionTruth.safeParse(withExpected({ status: "needs_review" })).success).toBe(false);
    expect(
      ExtractionTruth.safeParse(withExpected({ status: "needs_review", reviewChecks: ["port"] }))
        .success,
    ).toBe(true);
  });

  it("rejects a quote truth without lines", () => {
    expect(
      ExtractionTruth.safeParse(withExpected({ quote: { ...truthQuote, lines: [] } })).success,
    ).toBe(false);
  });

  it("rejects not_a_quote with a non-null quote", () => {
    const bad = withExpected({ kind: "not_a_quote", status: "not_a_quote" });
    expect(ExtractionTruth.safeParse(bad).success).toBe(false);
    const ok = withExpected({ kind: "not_a_quote", status: "not_a_quote", quote: null });
    expect(ExtractionTruth.safeParse(ok).success).toBe(true);
  });

  it("rejects kind quote with a null quote unless needs_review", () => {
    expect(ExtractionTruth.safeParse(withExpected({ quote: null })).success).toBe(false);
    expect(
      ExtractionTruth.safeParse(
        withExpected({ quote: null, status: "needs_review", reviewChecks: ["unreadable"] }),
      ).success,
    ).toBe(true);
  });

  it("rejects a bad date string", () => {
    const bad = withExpected({ quote: { ...truthQuote, validUntil: "20/11/2026" } });
    expect(ExtractionTruth.safeParse(bad).success).toBe(false);
  });

  it("parses a normalised view with null ids and no lines", () => {
    const view = {
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
    expect(NormalisedView.safeParse(view).success).toBe(true);
  });

  it("ReviewCorrection rejects qty <= 0", () => {
    const correction = {
      vesselImo: "9123456",
      portUnlocode: "ESALG",
      supplierId: 3,
      currency: "USD",
      validUntil: null,
      deliveryFrom: "2026-11-18",
      deliveryTo: null,
      bargeFee: 0,
      lines: [{ grade: "VLSFO", qtyMt: 800, pricePerMt: 600 }],
    };
    expect(ReviewCorrection.safeParse(correction).success).toBe(true);
    const bad = { ...correction, lines: [{ grade: "VLSFO", qtyMt: 0, pricePerMt: 600 }] };
    expect(ReviewCorrection.safeParse(bad).success).toBe(false);
  });
});

describe("Phase 4 tool inputs", () => {
  it("the Phase 2 tool inputs still parse their old payloads and stay strict", () => {
    expect(VesselStatusInput.parse({ vessel: " Aegean Pioneer " })).toEqual({
      vessel: "Aegean Pioneer",
    });
    expect(PlanBunkeringInput.safeParse({ vessel: "9123456" }).success).toBe(true);
    // No vessel: plan every vessel's open requirements.
    expect(PlanBunkeringInput.parse({})).toEqual({});
    expect(PlanBunkeringInput.safeParse({ vessel: "" }).success).toBe(false);
    expect(VesselStatusInput.safeParse({ vessel: "x", extra: 1 }).success).toBe(false);
    const proposal = {
      type: "purchase_order",
      calculationId: 3,
      optionId: "algeciras-nordwind",
      factRefs: ["f_calc_3_x"],
      rationale: "Lowest total cost.",
    };
    expect(ProposeActionInput.safeParse(proposal).success).toBe(true);
    expect(ProposeActionInput.safeParse({ ...proposal, qtyMt: 500 }).success).toBe(false);
    expect(ProposedAction.safeParse(proposal).success).toBe(true);
  });

  it("ListFleetInput takes nothing, ListQuotesInput takes optional filters, EmissionsInput a vessel", () => {
    expect(ListFleetInput.safeParse({}).success).toBe(true);
    expect(ListFleetInput.safeParse({ vessel: "x" }).success).toBe(false);
    expect(ListQuotesInput.safeParse({}).success).toBe(true);
    expect(
      ListQuotesInput.safeParse({
        vessel: "A",
        port: "ESALG",
        grade: "VLSFO",
        includeExpired: true,
      }).success,
    ).toBe(true);
    expect(ListQuotesInput.safeParse({ grade: "DIESEL" }).success).toBe(false);
    expect(EmissionsInput.safeParse({ vessel: "Aegean Pioneer" }).success).toBe(true);
    expect(EmissionsInput.safeParse({}).success).toBe(false);
  });

  it("CalculateInput needs exactly 2 operands for the binary ops and 1-10 otherwise", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `f_x${i}`);
    expect(CalculateInput.safeParse({ op: "subtract", operands: ids(2) }).success).toBe(true);
    expect(CalculateInput.safeParse({ op: "subtract", operands: ids(3) }).success).toBe(false);
    for (const op of ["divide", "difference", "percent_change"]) {
      expect(CalculateInput.safeParse({ op, operands: ids(1) }).success).toBe(false);
    }
    expect(CalculateInput.safeParse({ op: "sum", operands: ids(10) }).success).toBe(true);
    expect(CalculateInput.safeParse({ op: "sum", operands: ids(11) }).success).toBe(false);
    expect(CalculateInput.safeParse({ op: "max", operands: [] }).success).toBe(false);
    expect(CalculateInput.safeParse({ op: "pow", operands: ids(2) }).success).toBe(false);
    expect(CalculateInput.safeParse({ op: "sum", operands: ["12.5"] }).success).toBe(false);
  });
});

describe("Phase 4 ask events, recommendations and drafts", () => {
  const response = {
    conversationId: 1,
    messageId: 2,
    answer: "ok",
    facts: [],
    gate: {
      passed: true,
      repaired: false,
      ungroundedCount: 0,
      attempts: [{ attempt: 1, passed: true, ungroundedCount: 0 }],
    },
    recommendationIds: [],
    llmCallIds: [],
  };

  it("AskResponse.gate carries the attempts, each 1 or 2", () => {
    expect(AskResponse.safeParse(response).success).toBe(true);
    const bad = {
      ...response,
      gate: { ...response.gate, attempts: [{ attempt: 3, passed: true, ungroundedCount: 0 }] },
    };
    expect(AskResponse.safeParse(bad).success).toBe(false);
  });

  it("AskResponse (HTTP) counts the withheld numbers and never carries them", () => {
    const withheld = {
      ...response,
      answer: null,
      gate: {
        passed: false,
        repaired: true,
        ungroundedCount: 1,
        attempts: [
          { attempt: 1, passed: false, ungroundedCount: 1 },
          { attempt: 2, passed: false, ungroundedCount: 1 },
        ],
      },
    };
    expect(AskResponse.safeParse(withheld).success).toBe(true);
    const leaked = { ...withheld, gate: { ...withheld.gate, ungroundedNumbers: ["9999.5"] } };
    expect(AskResponse.safeParse(leaked).success).toBe(false);
    const leakedAttempt = {
      ...withheld,
      gate: {
        ...withheld.gate,
        attempts: [{ attempt: 1, passed: false, ungroundedCount: 1, ungroundedNumbers: ["1"] }],
      },
    };
    expect(AskResponse.safeParse(leakedAttempt).success).toBe(false);
    expect(AskResponse.safeParse({ ...withheld, withheldAnswer: "9999.5" }).success).toBe(false);
    expect(AskEvent.safeParse({ type: "answer", response: leaked }).success).toBe(false);
  });

  it("AskEvent discriminates on type and keeps answer text out of progress", () => {
    expect(
      AskEvent.safeParse({ type: "progress", tool: "plan_bunkering", phase: "started", ms: 0 })
        .success,
    ).toBe(true);
    expect(AskEvent.safeParse({ type: "answer", response }).success).toBe(true);
    expect(AskEvent.safeParse({ type: "error", message: "boom" }).success).toBe(true);
    expect(
      AskEvent.safeParse({
        type: "progress",
        tool: "t",
        phase: "finished",
        ms: 5,
        answer: "leaked text",
      }).success,
    ).toBe(false);
    expect(AskEvent.safeParse({ type: "progress", tool: "t", phase: "later", ms: 5 }).success).toBe(
      false,
    );
  });

  it("RecommendationStatus keeps its old values and adds executing and failed", () => {
    for (const s of ["pending", "approved", "rejected", "executed", "executing", "failed"]) {
      expect(RecommendationStatus.safeParse(s).success).toBe(true);
    }
    expect(RecommendationStatus.safeParse("sent").success).toBe(false);
  });

  it("DraftedMessage is always a draft", () => {
    const draft = {
      id: 1,
      recommendationId: 2,
      kind: "supplier_confirmation",
      to: "ops@nordwind.example",
      subject: "Confirmation",
      body: "Please confirm.",
      status: "draft",
      createdAt: new Date("2026-11-14T08:00:00Z"),
    };
    expect(DraftedMessage.safeParse(draft).success).toBe(true);
    expect(DraftedMessage.safeParse({ ...draft, status: "sent" }).success).toBe(false);
    expect(DraftedMessage.safeParse({ ...draft, kind: "press_release" }).success).toBe(false);
  });
});

describe("QaTruth", () => {
  const fact = { label: "Total cost", value: 1234.5, unit: "USD", tolerance: 0.01 };
  const answer = {
    id: "lookup-fob-1",
    tags: ["lookup", "fob"],
    question: "How much VLSFO is on board Aegean Pioneer?",
    expect: {
      kind: "answer",
      requiredFacts: [fact],
      proposedOptionId: null,
      mustNotPropose: false,
    },
  };
  const withExpect = (patch: object) => ({ ...answer, expect: { ...answer.expect, ...patch } });

  it("accepts an answer, an action, an abstain and a no_action", () => {
    expect(QaTruth.safeParse(answer).success).toBe(true);
    expect(
      QaTruth.safeParse(withExpect({ kind: "action", proposedOptionId: "opt-1" })).success,
    ).toBe(true);
    expect(
      QaTruth.safeParse(withExpect({ kind: "abstain", requiredFacts: [], mustNotPropose: true }))
        .success,
    ).toBe(true);
    expect(
      QaTruth.safeParse(withExpect({ kind: "no_action", requiredFacts: [], mustNotPropose: false }))
        .success,
    ).toBe(true);
  });

  it("an action without proposedOptionId fails; a non-action with one fails", () => {
    expect(QaTruth.safeParse(withExpect({ kind: "action" })).success).toBe(false);
    expect(QaTruth.safeParse(withExpect({ proposedOptionId: "opt-1" })).success).toBe(false);
  });

  it("abstain with requiredFacts fails, and abstain with mustNotPropose false fails", () => {
    expect(QaTruth.safeParse(withExpect({ kind: "abstain", mustNotPropose: true })).success).toBe(
      false,
    );
    expect(
      QaTruth.safeParse(withExpect({ kind: "abstain", requiredFacts: [], mustNotPropose: false }))
        .success,
    ).toBe(false);
  });

  it("requiredFacts must be non-empty for answer and action", () => {
    expect(QaTruth.safeParse(withExpect({ requiredFacts: [] })).success).toBe(false);
    expect(
      QaTruth.safeParse(withExpect({ kind: "no_action", requiredFacts: [fact] })).success,
    ).toBe(false);
  });

  it("is strict, needs a slug id and at least one tag", () => {
    expect(QaTruth.safeParse({ ...answer, extra: 1 }).success).toBe(false);
    expect(QaTruth.safeParse({ ...answer, id: "Has Space" }).success).toBe(false);
    expect(QaTruth.safeParse({ ...answer, tags: [] }).success).toBe(false);
    expect(
      QaTruth.safeParse(withExpect({ requiredFacts: [{ ...fact, tolerance: -1 }] })).success,
    ).toBe(false);
  });

  it("tags[0] must be one of the categories", () => {
    for (const category of QA_CATEGORIES) {
      expect(QaTruth.safeParse({ ...answer, tags: [category, "x"] }).success).toBe(true);
    }
    expect(QaTruth.safeParse({ ...answer, tags: ["fob", "lookup"] }).success).toBe(false);
    expect(QaTruth.safeParse({ ...answer, tags: ["Lookup"] }).success).toBe(false);
  });

  it("lists the seven question categories", () => {
    expect(QA_CATEGORIES).toEqual([
      "lookup",
      "comparison",
      "bunker_decision",
      "calculate",
      "abstain",
      "no_action",
      "injection",
    ]);
  });
});

describe("Phase 5 contracts", () => {
  const series = (n: number) => Array.from({ length: n }, () => 1);
  const point = (n: number, m = n) => ({
    lat: 36,
    lon: 14,
    waveHeightM: series(n),
    waveDirDeg: series(n),
    windSpeedKn: series(m),
    windDirDeg: series(n),
    currentSpeedKn: series(n),
    currentDirDeg: series(n),
  });
  const grid = { startAt: "2026-11-15T00:00:00Z", stepHours: 3, points: [point(4)] };

  it("WeatherGrid rejects series of unequal length", () => {
    expect(WeatherGrid.safeParse(grid).success).toBe(true);
    expect(WeatherGrid.safeParse({ ...grid, points: [point(4, 3)] }).success).toBe(false);
    expect(WeatherGrid.safeParse({ ...grid, points: [point(4), point(5)] }).success).toBe(false);
  });

  it("RouteSpeedInput rejects an empty candidates list", () => {
    const input = {
      startAt: "2026-11-15T00:00:00Z",
      candidates: [],
      baseline: { candidateId: "a", speedKn: 12 },
      curve: { refSpeedKn: 12, refMtPerDay: 30, auxMtPerDay: 2, minSpeedKn: 8, maxSpeedKn: 15 },
      speedStepKn: 0.5,
      stepNm: 10,
      arriveBy: null,
      notBefore: null,
      dailyCostUsd: 10000,
      fuelPriceUsdPerMt: { LSMGO: 800, VLSFO: 600, HSFO: 500 },
      etsCoverage: 0.5,
      market: { euaPriceEur: 70, eurUsd: 1.1, year: 2026 },
      weather: null,
    };
    expect(RouteSpeedInput.safeParse(input).success).toBe(false);
    const ok = {
      ...input,
      candidates: [
        {
          id: "a",
          label: "Direct",
          points: [
            { lat: 0, lon: 0 },
            { lat: 1, lon: 1 },
          ],
        },
      ],
    };
    expect(RouteSpeedInput.safeParse(ok).success).toBe(true);
  });

  it("AisObservation rejects an 8-digit mmsi", () => {
    const base = {
      kind: "static",
      name: null,
      shipType: null,
      destination: null,
      ts: "2026-11-15T00:00:00Z",
    };
    expect(AisObservation.safeParse({ ...base, mmsi: "123456789" }).success).toBe(true);
    expect(AisObservation.safeParse({ ...base, mmsi: "12345678" }).success).toBe(false);
  });

  it("PlanRouteSpeedInput rejects an unknown key", () => {
    expect(PlanRouteSpeedInput.safeParse({ vessel: "Aegean Pioneer" }).success).toBe(true);
    expect(PlanRouteSpeedInput.safeParse({ vessel: "x", speedKn: 12 }).success).toBe(false);
  });
});
