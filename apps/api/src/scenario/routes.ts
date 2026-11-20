/**
 * `/api/scenario`: the console's Scenario panel. GET reads the editable demo world; the rest edit
 * it (a presenter's own edits, never the model's) and answer with the new view. 403 when edits
 * are off on this stack, 404 for an unknown vessel, hazard or area, 422 when a value is out of
 * bounds or does not fit the vessel.
 */
import {
  Id,
  ScenarioHazardInput,
  ScenarioVesselPatch,
  ScenarioWeatherAreaInput,
} from "@pharos/shared";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { requireContentType } from "../http/require-content-type.js";
import {
  addHazard,
  addWeatherArea,
  patchVessel,
  readScenario,
  removeHazard,
  removeWeatherArea,
  resetScenario,
  type ScenarioDeps,
  ScenarioError,
} from "./service.js";

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const raw = await c.req.json().catch(() => {
    throw new ScenarioError(422, "The body is not valid JSON.");
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ScenarioError(
      422,
      first ? `${first.path.join(".") || "body"}: ${first.message}` : "The body is not valid.",
    );
  }
  return parsed.data;
}

const idParam = (c: Context): number => {
  const id = Id.safeParse(Number(c.req.param("id")));
  if (!id.success) throw new ScenarioError(404, "Unknown id.");
  return id.data;
};

export function createScenarioRoutes(deps: ScenarioDeps) {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof ScenarioError) {
      const error = { 403: "forbidden", 404: "not_found", 422: "invalid" }[err.status];
      return c.json({ error, message: err.message }, err.status);
    }
    throw err;
  });
  const json = requireContentType("application/json");

  app.get("/", async (c) => c.json(await readScenario(deps)));
  app.patch("/vessels/:id", json, async (c) =>
    c.json(await patchVessel(deps, idParam(c), await body(c, ScenarioVesselPatch))),
  );
  app.post("/hazards", json, async (c) =>
    c.json(await addHazard(deps, await body(c, ScenarioHazardInput))),
  );
  app.delete("/hazards/:id", async (c) => c.json(await removeHazard(deps, c.req.param("id"))));
  app.post("/weather-areas", json, async (c) =>
    c.json(await addWeatherArea(deps, await body(c, ScenarioWeatherAreaInput))),
  );
  app.delete("/weather-areas/:id", async (c) => c.json(await removeWeatherArea(deps, idParam(c))));
  app.post("/reset", async (c) => c.json(await resetScenario(deps)));
  return app;
}
