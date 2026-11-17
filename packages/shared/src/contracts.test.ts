import { describe, expect, it } from "vitest";
import {
  AisObservation,
  AisTraffic,
  AskEvent,
  AskResponse,
  AskResult,
  AuditEventView,
  BunkerOptionResult,
  CalculateInput,
  ConsumptionCurve,
  DecisionBody,
  DraftedMessage,
  EmissionsInput,
  ErpOrderRequest,
  EvalSummary,
  ExtractionOutput,
  ExtractionTruth,
  FuelEuCostInput,
  FuelEuCostResult,
  GradeAmounts,
  InboxItemDetail,
  ListFleetInput,
  ListQuotesInput,
  LlmCall,
  LoadCondition,
  NormalisedView,
  PlanBunkeringInput,
  PlanRouteSpeedInput,
  PortView,
  ProposeActionInput,
  ProposedAction,
  Provenance,
  QA_CATEGORIES,
  QaTruth,
  RecommendationStatus,
  RecommendationView,
  ReviewCorrection,
  ReviewReference,
  RouteLeg,
  RouteOptionResult,
  RouteSpeedInput,
  SimClockView,
  Vessel,
  VesselStatusInput,
  Voyage,
  VoyageDetail,
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
    const saving = {
      id: "f_plan_bunkering_7_savingVsCheapestHeadlineUsd",
      label: "Saving of the best option against the cheapest headline price, in total cost",
      value: 16171.54,
      unit: "USD",
      provenance: {
        source: "calculation",
        calculationId: 7,
        calculator: "planBunkers",
        path: "savingVsCheapestHeadlineUsd",
      },
    };
    const rec = {
      id: 1,
      type: "purchase_order",
      status: "executed",
      calculationId: 7,
      optionId: "MTMLA-kestrel",
      optionLabel: "Kestrel Marine Fuels at Marsaxlokk",
      summary: "Order LSMGO from Kestrel Marine Fuels at Marsaxlokk.",
      expectedSavingUsd: 16171.54,
      expectedSaving: saving,
      factRefs: ["f_plan_bunkering_7_bestOptionId"],
      facts: [saving],
      gatePassed: false,
      order: { orderId: 3, erpPoNumber: "PO-000001", erpSyncStatus: "synced" },
      instruction: null,
    };
    expect(RecommendationView.parse(rec).order?.erpPoNumber).toBe("PO-000001");
    // A voyage instruction: the recorded instruction, no order.
    const recorded = {
      instructionId: 2,
      candidateId: "B",
      speedKn: 11.5,
      eta: "2026-11-20T06:00:00.000Z",
    };
    expect(
      RecommendationView.safeParse({
        ...rec,
        type: "voyage_instruction",
        order: null,
        instruction: recorded,
      }).success,
    ).toBe(true);
    const { instruction: _i, ...noInstruction } = rec;
    expect(RecommendationView.safeParse(noInstruction).success).toBe(false);
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

  it("lists the ten question categories; the first seven are Phase 4's, in order", () => {
    expect(QA_CATEGORIES.slice(0, 7)).toEqual([
      "lookup",
      "comparison",
      "bunker_decision",
      "calculate",
      "abstain",
      "no_action",
      "injection",
    ]);
    expect(QA_CATEGORIES.slice(7)).toEqual(["route_speed", "congestion", "compliance"]);
  });

  it("accepts tags[0] = route_speed and congestion", () => {
    expect(QaTruth.safeParse({ ...answer, tags: ["route_speed"] }).success).toBe(true);
    expect(QaTruth.safeParse({ ...answer, tags: ["congestion", "x"] }).success).toBe(true);
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
      hazards: [],
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
      draughtM: null,
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

describe("Phase 6 contracts", () => {
  it("InboxItemDetail carries extractionId, nullable and required", () => {
    const base = {
      documentId: 1,
      sender: null,
      subject: null,
      receivedAt: "2026-11-15T00:00:00Z",
      kind: "email",
      extractionStatus: "failed",
      bodyText: "",
      extraction: null,
      checkResults: [],
      error: "model refused",
    };
    expect(InboxItemDetail.safeParse({ ...base, extractionId: 7 }).success).toBe(true);
    expect(InboxItemDetail.safeParse({ ...base, extractionId: null }).success).toBe(true);
    expect(InboxItemDetail.safeParse(base).success).toBe(false);
    expect(InboxItemDetail.safeParse({ ...base, extractionId: 0 }).success).toBe(false);
  });

  const curve = {
    refSpeedKn: 13,
    refMtPerDay: 30,
    auxMtPerDay: 2.5,
    minSpeedKn: 9,
    maxSpeedKn: 14.5,
  };

  it("ConsumptionCurve accepts a curve without load and one with a load condition", () => {
    expect(ConsumptionCurve.safeParse(curve).success).toBe(true);
    const load = { displacementMt: 36_864, refDisplacementMt: 72_000 };
    expect(ConsumptionCurve.safeParse({ ...curve, load }).success).toBe(true);
    expect(LoadCondition.safeParse(load).success).toBe(true);
  });

  it("ConsumptionCurve rejects a load with a zero displacement or an unknown key", () => {
    const zero = { displacementMt: 0, refDisplacementMt: 72_000 };
    expect(ConsumptionCurve.safeParse({ ...curve, load: zero }).success).toBe(false);
    const zeroRef = { displacementMt: 36_864, refDisplacementMt: 0 };
    expect(ConsumptionCurve.safeParse({ ...curve, load: zeroRef }).success).toBe(false);
    const extra = { displacementMt: 1, refDisplacementMt: 2, cargoMt: 3 };
    expect(LoadCondition.safeParse(extra).success).toBe(false);
  });

  it("AisObservation static accepts draughtM null or a number and requires the key", () => {
    const base = {
      kind: "static",
      mmsi: "123456789",
      name: null,
      shipType: null,
      destination: null,
      ts: "2026-11-15T00:00:00Z",
    };
    expect(AisObservation.safeParse({ ...base, draughtM: null }).success).toBe(true);
    expect(AisObservation.safeParse({ ...base, draughtM: 9.4 }).success).toBe(true);
    expect(AisObservation.safeParse(base).success).toBe(false);
  });

  it("AisTraffic carries draughtM and cogDeg, both nullable", () => {
    const row = {
      mmsi: "123456789",
      name: null,
      shipType: null,
      lat: 36,
      lon: -5,
      sogKn: null,
      navStatus: null,
      destination: null,
      updatedAt: new Date("2026-11-15T00:00:00Z"),
    };
    expect(AisTraffic.safeParse({ ...row, draughtM: null, cogDeg: null }).success).toBe(true);
    expect(AisTraffic.safeParse({ ...row, draughtM: 11.2, cogDeg: 271.5 }).success).toBe(true);
    expect(AisTraffic.safeParse(row).success).toBe(false);
  });

  it("Vessel needs a positive lightshipMt; Voyage a nonnegative cargoMt and ballastMt", () => {
    const vessel = {
      id: 1,
      imo: "9480019",
      mmsi: "999000001",
      name: "MV Test",
      shipType: "bulk_carrier",
      dwt: 58_000,
      lightshipMt: 11_000,
      trackingSource: "simulator",
      tankCapacityMt: { LSMGO: 600, VLSFO: 1_500, HSFO: 0 },
      consumptionCurve: curve,
      dailyCostUsd: 16_000,
    };
    expect(Vessel.safeParse(vessel).success).toBe(true);
    expect(Vessel.safeParse({ ...vessel, lightshipMt: 0 }).success).toBe(false);
    const voyage = {
      id: 1,
      vesselId: 1,
      voyageNo: "AP-2611",
      originPortId: 1,
      destinationPortId: 2,
      plannedSpeedKn: 12.5,
      plannedRoute: [1, 2],
      status: "underway",
      departedAt: null,
      cargoMt: 0,
      ballastMt: 18_000,
    };
    expect(Voyage.safeParse(voyage).success).toBe(true);
    expect(Voyage.safeParse({ ...voyage, cargoMt: -1 }).success).toBe(false);
    const { ballastMt: _b, ...noBallast } = voyage;
    expect(Voyage.safeParse(noBallast).success).toBe(false);
  });

  it("FuelEuCostInput is strict and takes an ETS coverage factor", () => {
    const input = {
      fuelMt: { LSMGO: 0, VLSFO: 0, HSFO: 100 },
      coverage: 1,
      year: 2026,
      eurUsd: 1.08,
    };
    expect(FuelEuCostInput.safeParse(input).success).toBe(true);
    expect(FuelEuCostInput.safeParse({ ...input, coverage: 0.7 }).success).toBe(false);
    expect(FuelEuCostInput.safeParse({ ...input, year: 2026.5 }).success).toBe(false);
    expect(FuelEuCostInput.safeParse({ ...input, extra: 1 }).success).toBe(false);
  });

  it("FuelEuCostResult has a nullable target and a signed compliance balance", () => {
    const result = {
      energyMj: 4_050_000,
      intensityGPerMj: 91.7442,
      targetGPerMj: 89.3368,
      complianceBalanceT: -9.75,
      penaltyEur: 6_220.9,
      penaltyUsd: 6_718.6,
    };
    expect(FuelEuCostResult.safeParse(result).success).toBe(true);
    expect(FuelEuCostResult.safeParse({ ...result, targetGPerMj: null }).success).toBe(true);
    expect(FuelEuCostResult.safeParse({ ...result, penaltyEur: -1 }).success).toBe(false);
  });

  it("bunker and route option results carry a nonnegative fuelEuCostUsd", () => {
    expect(BunkerOptionResult.shape.fuelEuCostUsd.safeParse(0).success).toBe(true);
    expect(BunkerOptionResult.shape.fuelEuCostUsd.safeParse(-1).success).toBe(false);
    expect(RouteOptionResult.shape.fuelEuCostUsd.safeParse(12.5).success).toBe(true);
    expect(RouteOptionResult.shape.fuelEuCostUsd.safeParse(-1).success).toBe(false);
  });

  it("QA_CATEGORIES gains compliance, appended last", () => {
    expect(QA_CATEGORIES).toHaveLength(10);
    expect(QA_CATEGORIES[9]).toBe("compliance");
  });

  it("SimClockView is strict and needs anchor, now and pinned", () => {
    const ok = {
      anchor: "2026-11-14T08:00:00.000Z",
      now: "2026-11-14T08:05:00.000Z",
      pinned: true,
    };
    expect(SimClockView.parse(ok)).toEqual(ok);
    expect(() => SimClockView.parse({ ...ok, extra: 1 })).toThrow();
    expect(() => SimClockView.parse({ anchor: ok.anchor, now: ok.now })).toThrow();
  });

  it("PortView carries a position and the EU flag", () => {
    const port = {
      id: 1,
      name: "Rotterdam",
      unlocode: "NLRTM",
      position: { lat: 51.9, lon: 4.1 },
      isEu: true,
    };
    expect(PortView.parse(port)).toEqual(port);
    expect(() => PortView.parse({ ...port, position: { lat: 91, lon: 4 } })).toThrow();
  });

  it("VoyageDetail requires a planned track", () => {
    expect(VoyageDetail.shape.plannedTrack).toBeDefined();
    expect(VoyageDetail.shape.plannedTrack.safeParse([{ lat: 1, lon: 2 }]).success).toBe(true);
  });

  it("AuditEventView takes an ISO time", () => {
    const row = {
      id: 1,
      recommendationId: 2,
      kind: "approved",
      actor: "operator",
      detail: {},
      at: "2026-11-14T08:05:00.000Z",
    };
    expect(AuditEventView.parse(row).at).toBe(row.at);
    expect(() => AuditEventView.parse({ ...row, at: "yesterday" })).toThrow();
  });

  it("ReviewReference and DecisionBody are strict", () => {
    expect(ReviewReference.parse({ vessels: [], ports: [], suppliers: [] })).toBeTruthy();
    expect(() => ReviewReference.parse({ vessels: [], ports: [] })).toThrow();
    expect(DecisionBody.parse({})).toEqual({});
    expect(DecisionBody.parse({ decidedBy: "  ops  " })).toEqual({ decidedBy: "ops" });
    expect(() => DecisionBody.parse({ decidedBy: "" })).toThrow();
    expect(() => DecisionBody.parse({ approve: true })).toThrow();
  });

  it("EvalSummary accepts only live runs and k <= n", () => {
    const suite = {
      suite: "qa",
      split: "dev",
      label: "dev-haiku-p6",
      model: "claude-haiku-5-5",
      promptVersion: "agent-system/v5",
      runAt: "2026-11-16T10:00:00.000Z",
      mode: "live",
      metrics: [
        { key: "grounded", label: "Grounded answers", k: 33, n: 33, rate: 1, ci95: [0.89, 1] },
      ],
      latency: [{ key: "answerMean", label: "Answer, mean", seconds: 4.6 }],
      costUsdPerItem: 0.001,
    };
    const ok = { generatedAt: "2026-11-16T10:05:00.000Z", suites: [suite] };
    expect(EvalSummary.parse(ok)).toEqual(ok);
    expect(() => EvalSummary.parse({ ...ok, suites: [{ ...suite, mode: "replay" }] })).toThrow();
    const held = { ...suite, split: "heldout", label: "heldout-final" };
    expect(EvalSummary.parse({ ...ok, suites: [held, suite] }).suites).toHaveLength(2);
    expect(() => EvalSummary.parse({ ...ok, suites: [{ ...suite, split: "train" }] })).toThrow();
    const bad = { ...suite, metrics: [{ ...suite.metrics[0], k: 34 }] };
    expect(() => EvalSummary.parse({ ...ok, suites: [bad] })).toThrow();
  });

  it("EvalSummary accepts a held-out entry", () => {
    const suite = {
      suite: "extraction",
      split: "heldout",
      label: "heldout-final",
      model: "claude-haiku-5-5",
      promptVersion: "extract/v3",
      runAt: "2026-11-16T10:00:00.000Z",
      mode: "live",
      metrics: [{ key: "errors", label: "Errors", k: 0, n: 156, rate: 0, ci95: [0, 0.02] }],
      latency: [],
      costUsdPerItem: 0.001,
    };
    const ok = { generatedAt: "2026-11-16T10:05:00.000Z", suites: [suite] };
    expect(EvalSummary.parse(ok)).toEqual(ok);
  });

  it("EvalSummary rejects two entries with the same suite and split", () => {
    const suite = {
      suite: "qa",
      split: "dev",
      label: "a",
      model: "m",
      promptVersion: "p",
      runAt: "2026-11-16T10:00:00.000Z",
      mode: "live",
      metrics: [],
      latency: [],
      costUsdPerItem: 0,
    };
    const at = "2026-11-16T10:05:00.000Z";
    expect(() => EvalSummary.parse({ generatedAt: at, suites: [suite, suite] })).toThrow(
      /duplicate/,
    );
    const other = { ...suite, split: "heldout" };
    expect(EvalSummary.parse({ generatedAt: at, suites: [other, suite] })).toBeTruthy();
  });
});
