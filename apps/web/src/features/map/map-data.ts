/**
 * The map's reads. Every one is a GET parsed with its `@pharos/shared` schema; the one POST
 * (`/api/route-plan`) lives in `usePlanRoute` and only runs when the operator presses a Plan button.
 */
import {
  AisTrafficList,
  HazardZoneList,
  listOf,
  PlanRouteSpeedInput,
  PortCongestionList,
  PortList,
  RoutePlanResponse,
  VesselDetail,
  VesselSummary,
  VoyageDetail,
  WeatherView,
} from "@pharos/shared";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { api, isApiFailure } from "@/lib/api";
import { queryKeys } from "@/lib/queries";

const VesselList = listOf(VesselSummary);

/** AIS traffic changes every few seconds in a live session: poll on the brief's 15 s. */
export const TRAFFIC_POLL_MS = 15_000;

export const useVessels = () =>
  useQuery({
    queryKey: queryKeys.vessels,
    queryFn: ({ signal }) => api.get("/api/vessels", VesselList, { signal }),
    refetchInterval: 30_000,
  });

export const useVesselDetail = (id: number | null) =>
  useQuery({
    queryKey: queryKeys.vessel(id ?? 0),
    queryFn: ({ signal }) => api.get(`/api/vessels/${id}`, VesselDetail, { signal }),
    enabled: id !== null,
  });

export const useVoyage = (id: number | null | undefined) =>
  useQuery({
    queryKey: queryKeys.voyage(id ?? 0),
    queryFn: ({ signal }) => api.get(`/api/voyages/${id}`, VoyageDetail, { signal }),
    enabled: id !== null && id !== undefined,
  });

export const useTraffic = () =>
  useQuery({
    queryKey: queryKeys.traffic,
    queryFn: ({ signal }) => api.get("/api/traffic", AisTrafficList, { signal }),
    refetchInterval: TRAFFIC_POLL_MS,
  });

export const useHazards = () =>
  useQuery({
    queryKey: queryKeys.hazards,
    queryFn: ({ signal }) => api.get("/api/hazards", HazardZoneList, { signal }),
    refetchInterval: 60_000,
  });

export const useCongestion = () =>
  useQuery({
    queryKey: queryKeys.congestion,
    queryFn: ({ signal }) => api.get("/api/congestion", PortCongestionList, { signal }),
    refetchInterval: 60_000,
  });

export const usePorts = () =>
  useQuery({
    queryKey: queryKeys.ports,
    queryFn: ({ signal }) => api.get("/api/ports", PortList, { signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });

/** One forecast step. A 404 means there is no snapshot at all: the layer is off, not failing. */
export function useWeather(step: number, enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.weather(step),
    queryFn: ({ signal }) => api.get(`/api/weather?step=${step}`, WeatherView, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const noSnapshot = isApiFailure(query.error) && query.error.status === 404;
  return { ...query, noSnapshot };
}

/** `POST /api/route-plan`. Only ever `mutate`d from a Plan route button. */
export function usePlanRoute() {
  return useMutation({
    mutationFn: (input: PlanRouteSpeedInput) =>
      api.post("/api/route-plan", PlanRouteSpeedInput.parse(input), RoutePlanResponse),
  });
}

/** AIS traffic without our own fleet: the simulator writes fleet vessels into `ais_traffic` with
 * their fleet MMSIs, and the fleet layer already draws them. */
export function publicShips(
  items: AisTrafficList["items"],
  fleet: readonly { mmsi: string }[],
): AisTrafficList["items"] {
  const own = new Set(fleet.map((v) => v.mmsi));
  return items.filter((s) => !own.has(s.mmsi));
}
