import type {
  InboxItem,
  InboxItemDetail,
  QuoteView,
  RecommendationView,
  VesselDetail,
  VesselSummary,
  VoyageDetail,
  VoyageSummary,
} from "@pharos/shared";

/** Where the read routes get their data: the database (`server.ts`) or fixtures (tests). */
export interface ReadSource {
  /** Sent as the `x-pharos-data` header on every read response. */
  readonly dataTag: "fixture" | "db";
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
}
