import type {
  AuditEventView,
  Id,
  InboxItem,
  InboxItemDetail,
  PortView,
  QuoteView,
  RecommendationView,
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
}
