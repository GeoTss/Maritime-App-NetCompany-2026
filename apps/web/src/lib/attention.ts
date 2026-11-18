/**
 * What needs the operator right now, in one list: proposals awaiting a decision, vessels with an
 * alert, quotes to review and hazards on the map. The top bar's counts and the map's "Needs you"
 * column both read this, so they cannot disagree. Counting items is the only arithmetic here.
 */
import {
  HazardZoneList,
  InboxItem,
  listOf,
  RecommendationView,
  VesselSummary,
} from "@pharos/shared";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";

export type AttentionItem =
  | { kind: "vessel_alert"; vesselId: number; vesselName: string; alert: string }
  | { kind: "quote_review"; documentId: number; subject: string; sender: string }
  | {
      kind: "proposal";
      recommendationId: number;
      type: RecommendationView["type"];
      summary: string;
    }
  | { kind: "hazard"; hazardId: string; label: string; synthetic: boolean };

/** Order: proposals, vessel alerts, quotes to review, hazards; within a kind, oldest first. */
export function attentionItems(input: {
  vessels: readonly VesselSummary[];
  inbox: readonly InboxItem[];
  recommendations: readonly RecommendationView[];
  hazards: HazardZoneList["items"];
}): AttentionItem[] {
  const proposals = input.recommendations
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.id - b.id)
    .map<AttentionItem>((r) => ({
      kind: "proposal",
      recommendationId: r.id,
      type: r.type,
      summary: r.summary,
    }));
  const alerts = input.vessels
    .filter((v) => v.alerts.length > 0)
    .sort((a, b) => a.id - b.id)
    .flatMap<AttentionItem>((v) =>
      v.alerts.map((alert) => ({
        kind: "vessel_alert",
        vesselId: v.id,
        vesselName: v.name,
        alert,
      })),
    );
  const quotes = input.inbox
    .filter((i) => i.extractionStatus === "needs_review")
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
    .map<AttentionItem>((i) => ({
      kind: "quote_review",
      documentId: i.documentId,
      subject: i.subject ?? "(no subject)",
      sender: i.sender ?? "unknown sender",
    }));
  const hazards = input.hazards.map<AttentionItem>((h) => ({
    kind: "hazard",
    hazardId: h.id,
    label: h.label,
    synthetic: h.source === "synthetic" || h.kind === "synthetic",
  }));
  return [...proposals, ...alerts, ...quotes, ...hazards];
}

/**
 * Hazards the operator has acknowledged in this session: they leave the "Needs you" list and its
 * count, and stay drawn on the map. Kept in memory only, so a reload shows every hazard again.
 */
let acknowledged: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function acknowledgeHazard(id: string) {
  acknowledged = new Set([...acknowledged, id]);
  for (const listener of listeners) listener();
}

const InboxItems = listOf(InboxItem);
const Recommendations = listOf(RecommendationView);
const Vessels = listOf(VesselSummary);

/**
 * The live list. Same query keys as the Inbox, Approvals and map screens, so one request serves
 * all of them; a failed read contributes nothing (the screens say so themselves).
 */
export function useAttention(): { items: AttentionItem[]; isPending: boolean } {
  const seen = useSyncExternalStore(subscribe, () => acknowledged);
  const inbox = useQuery({
    queryKey: queryKeys.inbox,
    queryFn: ({ signal }) => api.get("/api/inbox", InboxItems, { signal }),
    retry: false,
  });
  const recs = useQuery({
    queryKey: queryKeys.recommendations,
    queryFn: ({ signal }) => api.get("/api/recommendations", Recommendations, { signal }),
    retry: false,
  });
  const vessels = useQuery({
    queryKey: queryKeys.vessels,
    queryFn: ({ signal }) => api.get("/api/vessels", Vessels, { signal }),
    refetchInterval: 30_000,
    retry: false,
  });
  const hazards = useQuery({
    queryKey: queryKeys.hazards,
    queryFn: ({ signal }) => api.get("/api/hazards", HazardZoneList, { signal }),
    refetchInterval: 60_000,
    retry: false,
  });
  const items = attentionItems({
    vessels: vessels.data?.items ?? [],
    inbox: inbox.data?.items ?? [],
    recommendations: recs.data?.items ?? [],
    hazards: (hazards.data?.items ?? []).filter((h) => !seen.has(h.id)),
  });
  return {
    items,
    isPending: inbox.isPending || recs.isPending || vessels.isPending || hazards.isPending,
  };
}
