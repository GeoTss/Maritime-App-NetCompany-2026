import type {
  AuditEventView,
  BunkerPlanView,
  Id,
  InboxItem,
  InboxItemDetail,
  PortView,
  QuoteView,
  RecommendationView,
  RoutePlanView,
  VesselDetail,
  VesselSummary,
  VoyageDetail,
  VoyageSummary,
} from "@pharos/shared";

/** Where the read routes get their data: the database (`server.ts`) or fixtures (tests). */
export interface ReadSource {
  listVessels(): Promise<VesselSummary[]>;
  getVessel(id: number): Promise<VesselDetail | null>;
  listVoyages(): Promise<VoyageSummary[]>;
  getVoyage(id: number): Promise<VoyageDetail | null>;
  listInbox(): Promise<InboxItem[]>;
  getInboxItem(id: number): Promise<InboxItemDetail | null>;
  listQuotes(): Promise<QuoteView[]>;
  getQuote(id: number): Promise<QuoteView | null>;
  listRecommendations(): Promise<RecommendationView[]>;
  getRecommendation(id: number): Promise<RecommendationView | null>;
  /** The anchor the served world was generated at; null when no world is stored. */
  worldAnchor(): Promise<Date | null>;
  listPorts(): Promise<PortView[]>;
  /** Audit events in the order they happened, all of them or one recommendation's. */
  listAuditEvents(recommendationId: Id | null): Promise<AuditEventView[]>;
  /** A stored bunker plan, whole; null when there is no readable bunker plan with this id. */
  getBunkerPlan(calculationId: Id): Promise<BunkerPlanView | null>;
  /**
   * A stored fleet-vessel route plan, rebuilt from the stored calculation; null when there is no
   * readable route plan with this id, or it is an AIS ship's.
   */
  getRoutePlan(calculationId: Id): Promise<RoutePlanView | null>;
}
