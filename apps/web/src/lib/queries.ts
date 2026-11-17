/**
 * Server state: one QueryClient, the query keys every screen shares, the shell's own reads and
 * the mutations more than one screen runs. Queries are GETs only; a POST never runs from a query
 * (it is an explicit user action).
 */
import {
  HealthResponse,
  ProposeBody,
  ProposeResult,
  SimClockView,
  SourceStatusList,
} from "@pharos/shared";
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isApiFailure } from "@/lib/api";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx will not change on retry; a dropped connection might.
        retry: (count, err) =>
          count < 2 && !(isApiFailure(err) && err.status >= 400 && err.status < 500),
        refetchOnWindowFocus: false,
        staleTime: 10_000,
      },
      mutations: { retry: false },
    },
  });
}

/** Query keys, so screens invalidate each other's data by name. */
export const queryKeys = {
  health: ["health"] as const,
  clock: ["clock"] as const,
  sources: ["sources"] as const,
  vessels: ["vessels"] as const,
  vessel: (id: number) => ["vessels", id] as const,
  voyage: (id: number) => ["voyages", id] as const,
  ports: ["ports"] as const,
  quotes: ["quotes"] as const,
  traffic: ["traffic"] as const,
  hazards: ["hazards"] as const,
  congestion: ["congestion"] as const,
  weather: (step: number) => ["weather", step] as const,
  routePlan: (id: number) => ["route-plans", id] as const,
  bunkerPlan: (id: number) => ["bunker-plans", id] as const,
  inbox: ["inbox"] as const,
  inboxItem: (id: number) => ["inbox", id] as const,
  review: ["review"] as const,
  reviewReference: ["review", "reference"] as const,
  recommendations: ["recommendations"] as const,
  recommendation: (id: number) => ["recommendations", id] as const,
  drafts: (id: number) => ["recommendations", id, "drafts"] as const,
  audit: ["audit"] as const,
  evalSummary: ["eval", "summary"] as const,
};

/** `GET /api/clock`: the simulation clock. Re-read every 15 s; a frozen (pinned) clock rarely. */
export function useSimClock() {
  return useQuery({
    queryKey: queryKeys.clock,
    queryFn: ({ signal }) => api.get("/api/clock", SimClockView, { signal }),
    refetchInterval: (q) => (q.state.data?.pinned ? 60_000 : 15_000),
    retry: false,
  });
}

/** `GET /api/health`: how the API talks to the model (live, record or replay). Read once a minute. */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => api.get("/api/health", HealthResponse, { signal }),
    refetchInterval: 60_000,
    retry: false,
  });
}

/** `GET /api/sources`: live or recorded, per data source. */
export function useSourceStatus() {
  return useQuery({
    queryKey: queryKeys.sources,
    queryFn: ({ signal }) => api.get("/api/sources", SourceStatusList, { signal }),
    refetchInterval: 30_000,
  });
}

/**
 * `POST /api/recommendations`: a person proposes a purchase order or a voyage instruction from a
 * stored plan, without the assistant. The proposal is pending: nothing is ordered or sent until
 * someone approves it on Approvals. `created` is false when the same proposal was already pending
 * (that one is returned). A refusal is a 409 `not_proposable` whose message says why.
 *
 * Run only from a click. The proposals are refetched before the caller's `onSuccess` runs, so a
 * caller that selects the new proposal finds it in the list.
 */
export function useProposeRecommendation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ProposeBody) =>
      api.post("/api/recommendations", ProposeBody.parse(body), ProposeResult),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.recommendations }),
  });
}
