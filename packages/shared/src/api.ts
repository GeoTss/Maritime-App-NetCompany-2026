/** HTTP response shapes the ops console builds against. Times are ISO strings on the wire. */
import { z } from "zod";
import { ConsumptionCurve } from "./calculators.js";
import {
  AisTraffic,
  AuditEvent,
  CheckResult,
  DraftedMessage,
  ExtractionStatus,
  GateAttempt,
  LlmCall,
  NavHazard,
  PortCallPurpose,
  QuoteStatus,
  RecommendationStatus,
  RecommendationType,
  VoyageStatus,
} from "./entities.js";
import { NormalisedView } from "./evals/extraction-truth.js";
import { ExtractionOutput } from "./extraction/index.js";
import { Fact, FactId } from "./facts.js";
import { StormCell } from "./port-call.js";
import {
  Currency,
  EtsCoverageFactor,
  FuelGrade,
  GradeAmounts,
  Id,
  IsoDate,
  IsoDateTime,
  LatLon,
  ShipType,
} from "./primitives.js";
import { RouteCandidate, RouteSpeedResult, TrackFuel } from "./routing.js";
import { SecurityArea, SecurityQuote } from "./security.js";
import { AgentToolName } from "./tools.js";

export const ApiError = z.object({ error: z.string().min(1) });
export type ApiError = z.infer<typeof ApiError>;

/** `{ items: T[] }` — the envelope for every list endpoint. */
export const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

export const VesselSummary = z.object({
  id: Id,
  name: z.string(),
  imo: z.string(),
  mmsi: z.string(),
  shipType: ShipType,
  position: LatLon.nullable(),
  positionAt: IsoDateTime.nullable(),
  voyageId: Id.nullable(),
  robMt: GradeAmounts,
  /** Machine-readable flags, e.g. "lsmgo_below_margin_for_eca". */
  alerts: z.array(z.string()),
});
export type VesselSummary = z.infer<typeof VesselSummary>;

/**
 * The facts behind a vessel's panel readouts, the same facts `get_vessel_status` cites (same ids,
 * labels and values). Null entries: the vessel has no current voyage, or no later port call.
 */
/** What a vessel carries for its next call (raw stores, waste and out-of-date items). */
export const VesselNeedsFacts = z
  .object({
    crew: Fact,
    provisionsPersonDays: Fact,
    sludgeM3: Fact,
    sludgeCapacityM3: Fact,
    sewageM3: Fact,
    sewageCapacityM3: Fact,
    /** Each chart or publication missing or older than its current edition. */
    outdated: z.array(z.object({ onBoard: Fact.nullable(), current: Fact }).strict()),
  })
  .strict();
export type VesselNeedsFacts = z.infer<typeof VesselNeedsFacts>;

export const VesselFacts = z
  .object({
    robMt: z.object({ LSMGO: Fact, VLSFO: Fact, HSFO: Fact }).strict().nullable(),
    voyageNo: Fact.nullable(),
    nextPort: Fact.nullable(),
    nextPortEta: Fact.nullable(),
    /** Null for a vessel without stores data; absent in old payloads. */
    needs: VesselNeedsFacts.nullable().optional(),
  })
  .strict();
export type VesselFacts = z.infer<typeof VesselFacts>;

export const VesselDetail = VesselSummary.extend({
  dwt: z.number().positive(),
  tankCapacityMt: GradeAmounts,
  consumptionCurve: ConsumptionCurve,
  /**
   * Fuel on board along the rest of the current plan at the planned speed: the one fuel
   * calculation (`currentPlanFuel`) the vessel's alert and `get_vessel_status` read. Null when the
   * vessel has no current voyage.
   */
  fuelTrack: TrackFuel.nullable(),
  facts: VesselFacts,
});
export type VesselDetail = z.infer<typeof VesselDetail>;

export const VoyageSummary = z.object({
  id: Id,
  voyageNo: z.string(),
  vesselId: Id,
  vesselName: z.string(),
  status: VoyageStatus,
  originPortId: Id,
  destinationPortId: Id,
  plannedSpeedKn: z.number().positive(),
  nextEta: IsoDateTime.nullable(),
});
export type VoyageSummary = z.infer<typeof VoyageSummary>;

export const PortCallView = z.object({
  id: Id,
  portId: Id,
  portName: z.string(),
  sequence: z.number().int().nonnegative(),
  purpose: PortCallPurpose,
  eta: IsoDateTime,
  berthWindowStart: IsoDateTime.nullable(),
  berthWindowEnd: IsoDateTime.nullable(),
});
export type PortCallView = z.infer<typeof PortCallView>;

/**
 * The voyage instruction in force: the latest approved and recorded one. Its track, speed, ETA and
 * bunker stop are the stored route plan's, as the executor recorded them on approval.
 */
export const VoyageInstructionView = z
  .object({
    recommendationId: Id,
    /** The route candidate, or the bunker stop plan, that was instructed. */
    optionId: z.string(),
    instructedAt: IsoDateTime,
    /** The instructed route for the map (≥ 2 points). */
    track: z.array(LatLon),
    /** The bunker port's name; null for a route with no stop. */
    stopPortName: z.string().nullable(),
    facts: z
      .object({
        speedKn: Fact,
        eta: Fact,
        stopArriveAt: Fact.nullable(),
        stopDepartAt: Fact.nullable(),
        stopQtyMt: Fact.nullable(),
      })
      .strict(),
  })
  .strict();
export type VoyageInstructionView = z.infer<typeof VoyageInstructionView>;

export const VoyageDetail = VoyageSummary.extend({
  /** The instruction in force, which the map and the panel show instead of the first plan; else null. */
  instruction: VoyageInstructionView.nullable(),
  portCalls: z.array(PortCallView),
  /** The planned track for the map: the route legs' waypoints, joined in order (≥ 2 points). */
  plannedTrack: z.array(LatLon),
  legs: z.array(
    z.object({
      fromPortId: Id,
      toPortId: Id,
      distanceNm: z.number().nonnegative(),
      requiredGrade: FuelGrade,
      etsCoverage: EtsCoverageFactor,
    }),
  ),
});
export type VoyageDetail = z.infer<typeof VoyageDetail>;

export const InboxExtractionStatus = z.enum([
  "pending",
  "extracted",
  "needs_review",
  "accepted",
  "not_a_quote",
  "failed",
  "rejected",
]);
export const InboxItem = z.object({
  documentId: Id,
  sender: z.string().nullable(),
  subject: z.string().nullable(),
  receivedAt: IsoDateTime,
  kind: z.enum(["email", "pdf"]),
  extractionStatus: InboxExtractionStatus,
});
export type InboxItem = z.infer<typeof InboxItem>;

export const InboxItemDetail = InboxItem.extend({
  bodyText: z.string(),
  extraction: ExtractionOutput.nullable(),
  checkResults: z.array(CheckResult),
  /** Why the extraction failed, when it did (the message stored on the extraction). */
  error: z.string().nullable(),
  /** Id of the document's latest extraction (the one the fields above come from); null when it has none. */
  extractionId: Id.nullable(),
});
export type InboxItemDetail = z.infer<typeof InboxItemDetail>;

export const QuoteView = z.object({
  id: Id,
  supplierName: z.string(),
  portName: z.string(),
  currency: Currency,
  bargeFee: z.number().nonnegative(),
  validUntil: IsoDateTime.nullable(),
  status: QuoteStatus,
  lines: z.array(
    z.object({
      grade: FuelGrade,
      /** Null while the quote needs review and the written quantity is ambiguous. */
      qtyMt: z.number().positive().nullable(),
      pricePerMt: z.number().positive(),
    }),
  ),
  documentId: Id.nullable(),
});
export type QuoteView = z.infer<typeof QuoteView>;

/** The danger areas (Track 3), ranked most-needed first: by level, then by what they need. */
export const SecurityAreaList = z.object({ items: z.array(SecurityArea) });
export type SecurityAreaList = z.infer<typeof SecurityAreaList>;

/** A security provider's quote as the console lists it (names resolved, dates as ISO strings). */
export const SecurityQuoteView = z.object({
  id: Id,
  providerName: z.string(),
  embarkPortName: z.string(),
  disembarkPortName: z.string(),
  teamSize: z.number().int().positive(),
  dayRate: z.number().positive(),
  fixedFees: z.number().nonnegative(),
  minDays: z.number().int().nonnegative(),
  currency: Currency,
  validUntil: IsoDateTime.nullable(),
  status: SecurityQuote.shape.status,
  receivedAt: IsoDateTime,
});
export type SecurityQuoteView = z.infer<typeof SecurityQuoteView>;
export const SecurityQuoteList = z.object({ items: z.array(SecurityQuoteView) });
export type SecurityQuoteList = z.infer<typeof SecurityQuoteList>;

/** Where an approved purchase order stands with the ERP. */
export const ErpSyncStatus = z.enum(["pending", "synced", "failed"]);
export type ErpSyncStatus = z.infer<typeof ErpSyncStatus>;

/** The purchase order the executor wrote for a recommendation, and its ERP state. */
export const RecommendationOrder = z.object({
  orderId: Id,
  /** Null until the ERP has confirmed the order. */
  erpPoNumber: z.string().nullable(),
  erpSyncStatus: ErpSyncStatus,
});
export type RecommendationOrder = z.infer<typeof RecommendationOrder>;

/** The voyage instruction the executor recorded for an approved voyage-instruction proposal. */
export const RecommendationInstruction = z.object({
  instructionId: Id,
  candidateId: z.string().min(1),
  speedKn: z.number().positive(),
  eta: IsoDateTime,
  /** The bunker stop the instruction calls at; null for a route with no stop. */
  stop: z
    .object({
      unlocode: z.string(),
      portName: z.string(),
      arriveAt: IsoDateTime,
      departAt: IsoDateTime,
      qtyMt: z.number().positive(),
      quoteId: Id.nullable(),
    })
    .strict()
    .nullable(),
});
export type RecommendationInstruction = z.infer<typeof RecommendationInstruction>;

export const NamedFact = z.object({ name: z.string().min(1), fact: Fact }).strict();
export type NamedFact = z.infer<typeof NamedFact>;

export const BunkerOptionView = z
  .object({
    optionId: z.string().min(1),
    supplier: z.string().min(1),
    port: z
      .object({ id: Id, name: z.string().min(1), unlocode: z.string().min(1), position: LatLon })
      .strict(),
    rank: z.number().int().positive(),
    feasible: z.boolean(),
    best: z.boolean(),
    headlinePrice: Fact,
    totalCost: Fact,
    delay: Fact,
    /** Every view fact of the option with its short field name ("quantity", "total delivered cost", ...). */
    rows: z.array(NamedFact),
  })
  .strict();
export type BunkerOptionView = z.infer<typeof BunkerOptionView>;

export const BunkerPlanView = z
  .object({
    calculationId: Id,
    grade: FuelGrade,
    vesselId: Id.nullable(),
    voyageNo: z.string().nullable(),
    /** In rank order. */
    options: z.array(BunkerOptionView),
    marginVsRunnerUp: Fact.nullable(),
  })
  .strict();
export type BunkerPlanView = z.infer<typeof BunkerPlanView>;

/** The purchase order a voyage instruction with a bunker stop waits for. */
export const RecommendationDependency = z
  .object({
    quoteId: Id,
    /** "<supplier> at <port>". */
    optionLabel: z.string(),
    recommendationId: Id.nullable(),
    status: RecommendationStatus.nullable(),
    /** The order is approved, executing or executed. */
    satisfied: z.boolean(),
    /** What the instruction waits for: a fuel order (default) or a security order (Track 3). */
    orderType: z.enum(["purchase_order", "security_order"]).optional(),
  })
  .strict();
export type RecommendationDependency = z.infer<typeof RecommendationDependency>;

/**
 * `POST /api/recommendations`: a person proposes an action from a stored plan without the
 * assistant (same checks as `propose_action`). The proposal is pending until approved.
 */
export const ProposeBody = z
  .object({
    type: RecommendationType,
    calculationId: Id,
    optionId: z.string().min(1),
  })
  .strict();
export type ProposeBody = z.infer<typeof ProposeBody>;

export const ProposeResult = z
  .object({
    recommendationId: Id,
    /**
     * False when the voyage already has this proposal (waiting, approved or carried out): that one
     * is returned, never duplicated, even when it was proposed from an earlier plan.
     */
    created: z.boolean(),
    /** The returned proposal's status: `pending` for a new one. */
    status: RecommendationStatus,
  })
  .strict();
export type ProposeResult = z.infer<typeof ProposeResult>;

/** A proposal a plan's option already has: its id and where it stands. */
export const PlanProposal = z
  .object({ recommendationId: Id, status: RecommendationStatus })
  .strict();
export type PlanProposal = z.infer<typeof PlanProposal>;

/**
 * `GET /api/recommendations/for-plan?calculationId=&optionId=`: what a plan's option already has,
 * by the rule proposing uses, so a plan screen never offers a second order or instruction.
 */
export const PlanProposals = z
  .object({
    purchaseOrder: PlanProposal.nullable(),
    voyageInstruction: PlanProposal.nullable(),
    /** The security order this option already has (Track 3); absent or null when none. */
    securityOrder: PlanProposal.nullable().optional(),
    /**
     * The voyage's instruction in force when it is not this option's (another route, stop or
     * speed): a new instruction from this plan would replace it. Null when there is none, or when
     * `voyageInstruction` is it.
     */
    instructionInForce: PlanProposal.nullable(),
  })
  .strict();
export type PlanProposals = z.infer<typeof PlanProposals>;

export const RecommendationView = z.object({
  id: Id,
  type: RecommendationType,
  status: RecommendationStatus,
  calculationId: Id,
  optionId: z.string(),
  /**
   * The proposed option in words: `<supplier> at <port>` for a bunker option, the route's
   * description for a route. Null when the calculation is unreadable.
   */
  optionLabel: z.string().nullable(),
  summary: z.string(),
  expectedSavingUsd: z.number().nullable(),
  /**
   * The fact the expected saving is (one of `facts`: the plan's saving). Null when there is no
   * saving or the calculation is unreadable.
   */
  expectedSaving: Fact.nullable(),
  factRefs: z.array(FactId),
  facts: z.array(Fact),
  /** Whether the answer that proposed it passed the release gate; null when no ask made it. */
  gatePassed: z.boolean().nullable(),
  /** The purchase order written on approval; null before approval (or after a rejection). */
  order: RecommendationOrder.nullable(),
  /** The voyage instruction recorded on approval; null before it (and for a purchase order). */
  instruction: RecommendationInstruction.nullable(),
  /** The stored bunker plan behind a purchase order, when it is readable; else null. */
  bunkerPlan: BunkerPlanView.nullable(),
  /** The purchase order a voyage instruction with a bunker stop waits for; else null. */
  dependsOn: RecommendationDependency.nullable(),
});
export type RecommendationView = z.infer<typeof RecommendationView>;

// ---------- Phase 2: ingestion, ask, approval, metrics ----------

export const UploadResult = z.object({ documentId: Id, duplicate: z.boolean() });
export type UploadResult = z.infer<typeof UploadResult>;

export const DeliverResult = UploadResult.extend({
  /** Demo emails not yet delivered after this one. */
  remaining: z.number().int().nonnegative(),
});
export type DeliverResult = z.infer<typeof DeliverResult>;

export const AskRequest = z.object({
  question: z.string().trim().min(1).max(2000),
  conversationId: Id.nullable(),
});
export type AskRequest = z.infer<typeof AskRequest>;

/** Outcome of the release gate: every number in an answer must match a tool fact (see GateAttempt). */
export { GateAttempt } from "./entities.js";

/**
 * The full gate result, with the ungrounded numbers themselves. It stays inside the API: stored on
 * the assistant message (`content.gate`, `gate_attempts`) for review, audit and evals, and returned
 * by `runAgent`. HTTP responses carry `GateSummary` instead.
 */
export const GateResult = z.object({
  passed: z.boolean(),
  repaired: z.boolean(),
  ungroundedNumbers: z.array(z.string()),
  /** Each pass of the gate over an answer: the first, and the repair retry if there was one. */
  attempts: z.array(GateAttempt),
});
export type GateResult = z.infer<typeof GateResult>;

/** One gate attempt as the HTTP API shows it: how many numbers had no fact, never which. */
export const GateAttemptSummary = z
  .object({
    attempt: z.union([z.literal(1), z.literal(2)]),
    passed: z.boolean(),
    ungroundedCount: z.number().int().nonnegative(),
  })
  .strict();
export type GateAttemptSummary = z.infer<typeof GateAttemptSummary>;

/**
 * The gate as the HTTP API shows it. Counts only: a withheld number never reaches the user, not
 * even in a list of what was withheld. Strict, so a full `GateResult` fails to parse here.
 */
export const GateSummary = z
  .object({
    passed: z.boolean(),
    repaired: z.boolean(),
    ungroundedCount: z.number().int().nonnegative(),
    attempts: z.array(GateAttemptSummary),
  })
  .strict();
export type GateSummary = z.infer<typeof GateSummary>;

/**
 * A ship an answer is about, as the tools resolved it: a fleet vessel, or a public ship seen on AIS.
 * "Show on map" reads these instead of guessing from the answer text.
 */
export const AskSubject = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("vessel"), vesselId: Id }).strict(),
  z.object({ kind: z.literal("ais"), mmsi: z.string().min(1) }).strict(),
]);
export type AskSubject = z.infer<typeof AskSubject>;

const askFields = {
  conversationId: Id,
  messageId: Id,
  /** Null when the gate withheld the answer. */
  answer: z.string().nullable(),
  facts: z.array(Fact),
  recommendationIds: z.array(Id),
  llmCallIds: z.array(Id),
  /** The ships the tools resolved for this answer, deduplicated, in order of first appearance. */
  subjects: z.array(AskSubject),
};

/** What `runAgent` returns inside the API (and to the Q&A runner): the full gate. Never sent. */
export const AskResult = z.object({ ...askFields, gate: GateResult });
export type AskResult = z.infer<typeof AskResult>;

/** `POST /api/ask` (and the stream's answer event): the released answer and the gate's counts. */
export const AskResponse = z.object({ ...askFields, gate: GateSummary }).strict();
export type AskResponse = z.infer<typeof AskResponse>;

/**
 * One event of the streamed ask (SSE). Progress names the tool and its timing only: no answer text
 * is streamed before the release gate has passed it.
 */
export const AskEvent = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("progress"),
      /** The model's `tool_use` id: pairs a call's events when calls overlap. */
      callId: z.string().min(1),
      tool: AgentToolName,
      phase: z.enum(["started", "finished", "failed"]),
      ms: z.number().nonnegative(),
    })
    .strict(),
  z.object({ type: z.literal("answer"), response: AskResponse }).strict(),
  z.object({ type: z.literal("error"), message: z.string().min(1) }).strict(),
]);
export type AskEvent = z.infer<typeof AskEvent>;

export const DecisionResult = z.object({
  recommendationId: Id,
  status: RecommendationStatus,
  orderId: Id.nullable(),
  erpPoNumber: z.string().nullable(),
  erpSyncStatus: ErpSyncStatus.nullable(),
  /** The recorded voyage instruction (a voyage-instruction proposal once executed), else null. */
  instructionId: Id.nullable(),
});
export type DecisionResult = z.infer<typeof DecisionResult>;

export const LlmCallView = LlmCall.extend({ createdAt: IsoDateTime });
export type LlmCallView = z.infer<typeof LlmCallView>;

/** One extraction waiting for a human, with the checks that failed and the quoted evidence. */
export const ReviewItem = z.object({
  extractionId: Id,
  documentId: Id,
  subject: z.string(),
  sender: z.string(),
  receivedAt: IsoDateTime,
  failedChecks: z.array(CheckResult),
  normalised: NormalisedView,
  evidence: z.record(z.string(), z.string().nullable()),
});
export type ReviewItem = z.infer<typeof ReviewItem>;

/** The human's values for a quote under review. All fields are required. */
export const ReviewCorrection = z
  .object({
    vesselImo: z.string().regex(/^\d{7}$/),
    portUnlocode: z.string().length(5),
    supplierId: Id,
    currency: Currency,
    validUntil: IsoDate.nullable(),
    deliveryFrom: IsoDate.nullable(),
    deliveryTo: IsoDate.nullable(),
    bargeFee: z.number().nonnegative(),
    lines: z
      .array(
        z
          .object({
            grade: FuelGrade,
            qtyMt: z.number().positive(),
            pricePerMt: z.number().positive(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type ReviewCorrection = z.infer<typeof ReviewCorrection>;

export const ReviewDecision = z.object({
  extractionId: Id,
  status: ExtractionStatus,
  quoteId: Id.nullable(),
});
export type ReviewDecision = z.infer<typeof ReviewDecision>;

export const RoutePlanResponse = z
  .object({
    calculationId: Id,
    weatherSnapshotId: Id.nullable(),
    subject: z.string().min(1),
    destination: z.string().min(1),
    candidates: z.array(RouteCandidate),
    result: RouteSpeedResult,
    /** The plan's citable facts, the ones `plan_route_speed` returns: every number the map shows. */
    facts: z.array(Fact),
    /** Forecast cells over the heavy-weather limit the baseline meets (for the map); absent in old plans. */
    stormCells: z.array(StormCell).optional(),
    /** Milliseconds to plan: resolving the subject, building the route graph and candidates, optimising. */
    computeMs: z.number().nonnegative(),
  })
  .strict();
export type RoutePlanResponse = z.infer<typeof RoutePlanResponse>;

/** A stored route plan: the same as the live response, but the compute time is unknown. */
export const RoutePlanView = RoutePlanResponse.omit({ computeMs: true })
  .extend({ computeMs: z.number().nonnegative().nullable() })
  .strict();
export type RoutePlanView = z.infer<typeof RoutePlanView>;

export const AisTrafficView = AisTraffic.omit({ updatedAt: true }).extend({
  updatedAt: IsoDateTime,
});
export type AisTrafficView = z.infer<typeof AisTrafficView>;

export const NavHazardView = NavHazard.omit({ observedAt: true }).extend({
  observedAt: IsoDateTime,
});
export type NavHazardView = z.infer<typeof NavHazardView>;

/** An active hazard with the radius of its keep-out zone (nm). */
export const HazardZoneView = NavHazardView.extend({ zoneRadiusNm: z.number().positive() });
export type HazardZoneView = z.infer<typeof HazardZoneView>;

export const PortCongestionView = z
  .object({
    portId: Id,
    portName: z.string().min(1),
    unlocode: z.string().min(1),
    anchoredCount: z.number().int().nonnegative(),
    waitingHours: z.number().nonnegative(),
    observedAt: IsoDateTime,
    source: z.enum(["seed", "ais"]),
  })
  .strict();
export type PortCongestionView = z.infer<typeof PortCongestionView>;

export const WeatherView = z
  .object({
    snapshotId: Id,
    source: z.string().min(1),
    /** The forecast's first hour (UTC), the snapshot's `model_run` column. */
    forecastStart: z.string().nullable(),
    fetchedAt: IsoDateTime,
    startAt: IsoDateTime,
    stepHours: z.number().positive(),
    steps: z.number().int().positive(),
    step: z.number().int().nonnegative(),
    /** The served step's time (UTC): `stepTimes[step]`. */
    validAt: IsoDateTime,
    /** Every step's time (UTC), `steps` entries: startAt + k x stepHours. */
    stepTimes: z.array(IsoDateTime),
    /** The planning limit on significant wave height (m): the map draws heavier seas as storm. */
    heavyWeatherWaveM: z.number().positive(),
    points: z.array(
      z
        .object({
          lat: LatLon.shape.lat,
          lon: LatLon.shape.lon,
          waveHeightM: z.number().nullable(),
          waveDirDeg: z.number().nullable(),
          windSpeedKn: z.number().nullable(),
          windDirDeg: z.number().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type WeatherView = z.infer<typeof WeatherView>;

export const SourceStatusView = z
  .object({
    source: z.enum(["ais", "weather"]),
    mode: z.enum(["live", "recorded"]),
    detail: z.string().nullable(),
    updatedAt: IsoDateTime,
  })
  .strict();
export type SourceStatusView = z.infer<typeof SourceStatusView>;

export const AisTrafficList = listOf(AisTrafficView);
export type AisTrafficList = z.infer<typeof AisTrafficList>;
export const HazardZoneList = listOf(HazardZoneView);
export type HazardZoneList = z.infer<typeof HazardZoneList>;
export const PortCongestionList = listOf(PortCongestionView);
export type PortCongestionList = z.infer<typeof PortCongestionList>;
export const SourceStatusList = listOf(SourceStatusView);
export type SourceStatusList = z.infer<typeof SourceStatusList>;

// ---------- Phase 6: ops console ----------

/** `GET /api/clock`: the demo world's anchor and the clock every request reads. */
export const SimClockView = z
  .object({
    anchor: IsoDateTime,
    now: IsoDateTime,
    /** True when the stack runs on a pinned demo anchor (DEMO_ANCHOR), so `now` is frozen. */
    pinned: z.boolean(),
  })
  .strict();
export type SimClockView = z.infer<typeof SimClockView>;

/** A port for the map: name, code, position and whether it is in the EU. */
export const PortView = z
  .object({
    id: Id,
    name: z.string().min(1),
    unlocode: z.string().min(1),
    position: LatLon,
    isEu: z.boolean(),
  })
  .strict();
export type PortView = z.infer<typeof PortView>;
export const PortList = listOf(PortView);
export type PortList = z.infer<typeof PortList>;

/** One audit-log row as the console shows it. */
export const AuditEventView = AuditEvent.omit({ at: true }).extend({ at: IsoDateTime }).strict();
export type AuditEventView = z.infer<typeof AuditEventView>;
export const AuditEventList = listOf(AuditEventView);
export type AuditEventList = z.infer<typeof AuditEventList>;

/** A drafted message as the API serves it: the executor's draft with an ISO time. Pharos never sends it. */
export const DraftedMessageView = DraftedMessage.extend({ createdAt: IsoDateTime }).strict();
export type DraftedMessageView = z.infer<typeof DraftedMessageView>;
export const DraftedMessageList = listOf(DraftedMessageView);
export type DraftedMessageList = z.infer<typeof DraftedMessageList>;

/** `GET /api/review/reference`: the choices a reviewer picks from when correcting a quote. */
export const ReviewReference = z
  .object({
    vessels: z.array(z.object({ id: Id, imo: z.string(), name: z.string() }).strict()),
    ports: z.array(z.object({ id: Id, unlocode: z.string(), name: z.string() }).strict()),
    suppliers: z.array(z.object({ id: Id, name: z.string() }).strict()),
  })
  .strict();
export type ReviewReference = z.infer<typeof ReviewReference>;

/** The body of approve and reject: who decided (defaults to the operator). */
export const DecisionBody = z
  .object({ decidedBy: z.string().trim().min(1).max(100).optional() })
  .strict();
export type DecisionBody = z.infer<typeof DecisionBody>;

const Ci95 = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

/** `GET /api/eval/summary`: published live-run scorecards (dev and held-out, one entry per suite and split) for the evaluation page. */
export const EvalSummary = z
  .object({
    generatedAt: IsoDateTime,
    suites: z
      .array(
        z
          .object({
            suite: z.enum(["extraction", "qa"]),
            split: z.enum(["dev", "heldout"]),
            label: z.string().min(1),
            model: z.string().min(1),
            promptVersion: z.string().min(1),
            runAt: IsoDateTime,
            mode: z.literal("live"),
            metrics: z.array(
              z
                .object({
                  key: z.string().min(1),
                  label: z.string().min(1),
                  k: z.number().int().nonnegative(),
                  n: z.number().int().nonnegative(),
                  rate: z.number().min(0).max(1).nullable(),
                  ci95: Ci95.nullable(),
                  /** True for the metrics whose right answer is 0 (errors, unauthorised actions, unsafe auto-accepts). */
                  expectedZero: z.boolean(),
                })
                .strict()
                .refine((m) => m.k <= m.n, { message: "k must not exceed n" }),
            ),
            latency: z.array(
              z
                .object({
                  key: z.string().min(1),
                  label: z.string().min(1),
                  seconds: z.number().nonnegative(),
                })
                .strict(),
            ),
            costUsdPerItem: z.number().nonnegative(),
          })
          .strict(),
      )
      .superRefine((suites, ctx) => {
        const seen = new Set<string>();
        for (const [i, s] of suites.entries()) {
          const key = `${s.suite}/${s.split}`;
          if (seen.has(key)) {
            ctx.addIssue({ code: "custom", path: [i], message: `duplicate entry for ${key}` });
          }
          seen.add(key);
        }
      }),
  })
  .strict();
export type EvalSummary = z.infer<typeof EvalSummary>;
