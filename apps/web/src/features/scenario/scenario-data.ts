/**
 * The demo Scenario panel's data: `GET /api/scenario`, and one mutation for every edit. Each edit
 * answers with the whole view; what it changes on the map (vessels, hazards, weather, plans) is
 * read again, and a reset reads everything again (it reseeds the demo).
 */
import {
  type Id,
  type LatLon,
  type ScenarioHazardInput,
  type ScenarioVesselPatch,
  ScenarioView,
  type ScenarioWeatherAreaInput,
} from "@pharos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";

export const useScenario = () =>
  useQuery({
    queryKey: queryKeys.scenario,
    queryFn: ({ signal }) => api.get("/api/scenario", ScenarioView, { signal }),
    staleTime: 15_000,
  });

export type ScenarioEdit =
  | { kind: "vessel"; id: Id; patch: ScenarioVesselPatch }
  | { kind: "addHazard"; input: ScenarioHazardInput }
  | { kind: "removeHazard"; id: string }
  | { kind: "addArea"; input: ScenarioWeatherAreaInput }
  | { kind: "removeArea"; id: Id }
  | { kind: "reset" };

function send(edit: ScenarioEdit) {
  switch (edit.kind) {
    case "vessel":
      return api.patch(`/api/scenario/vessels/${edit.id}`, edit.patch, ScenarioView);
    case "addHazard":
      return api.post("/api/scenario/hazards", edit.input, ScenarioView);
    case "removeHazard":
      return api.del(`/api/scenario/hazards/${encodeURIComponent(edit.id)}`, ScenarioView);
    case "addArea":
      return api.post("/api/scenario/weather-areas", edit.input, ScenarioView);
    case "removeArea":
      return api.del(`/api/scenario/weather-areas/${edit.id}`, ScenarioView);
    case "reset":
      return api.post("/api/scenario/reset", {}, ScenarioView);
  }
}

/** What the map reads that an edit changes (a reset changes everything). */
const TOUCHED = [["vessels"], ["voyages"], ["hazards"], ["weather"], ["route-plans"]] as const;

export function useScenarioEdit(onEdited?: (edit: ScenarioEdit) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: async (view, edit) => {
      client.setQueryData(queryKeys.scenario, view);
      if (edit.kind === "reset") await client.invalidateQueries();
      else for (const key of TOUCHED) await client.invalidateQueries({ queryKey: [...key] });
      onEdited?.(edit);
    },
  });
}

/** A circle the map draws, dashed, while a hazard or a weather area is being placed. */
export interface ScenarioPreview {
  kind: "hazard" | "weather";
  center: LatLon;
  radiusNm: number;
}
