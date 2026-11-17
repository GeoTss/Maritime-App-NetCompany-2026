/**
 * `POST /api/recommendations/:id/approve|reject` → `DecisionResult`. The human decision; the
 * executor does the rest. The JSON body (`{}` or `{decidedBy}`, default "operator") names who
 * decided and nothing else: an order's values always come from the stored calculation and quote.
 *
 * Illegal moves (`TransitionError`) and refused decisions (`DecisionError`, e.g. `dependency_unmet`
 * for an instruction whose bunker stop has no approved purchase order) are 409 with the reason. Only `application/json` is accepted (415 otherwise): a cross-site HTML form can send only
 * form-encoded, multipart or text/plain bodies, so it can never approve or reject.
 */
import { DecisionBody, type DraftedMessageList } from "@pharos/shared";
import { Hono } from "hono";
import {
  approveRecommendation,
  DecisionError,
  draftsOf,
  type ExecutorDeps,
  rejectRecommendation,
} from "../executor/execute.js";
import { requireContentType } from "../http/require-content-type.js";
import { parseId } from "../read/routes.js";
import { TransitionError } from "./state.js";

export type ApprovalDeps = ExecutorDeps;

export const DEFAULT_DECIDED_BY = "operator";

export function createApprovalRoutes(deps: ApprovalDeps) {
  const app = new Hono();

  const decide = (path: "approve" | "reject", action: typeof approveRecommendation) =>
    app.post(`/:id/${path}`, requireContentType("application/json"), async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "not_found" }, 404);

      let raw: unknown;
      try {
        raw = JSON.parse(await c.req.text());
      } catch {
        return c.json({ error: "invalid_request", message: "Body must be JSON, e.g. {}." }, 400);
      }
      const body = DecisionBody.safeParse(raw);
      if (!body.success) {
        const message = body.error.issues
          .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
          .join("; ");
        return c.json({ error: "invalid_request", message }, 400);
      }

      try {
        return c.json(await action(deps, id, body.data.decidedBy ?? DEFAULT_DECIDED_BY));
      } catch (err) {
        if (err instanceof DecisionError) {
          return c.json(
            { error: err.code, message: err.message },
            err.code === "not_found" ? 404 : 409,
          );
        }
        if (err instanceof TransitionError) {
          return c.json({ error: "illegal_transition", message: err.message }, 409);
        }
        throw err;
      }
    });

  /** The drafted messages (read-only; Pharos never sends them). */
  app.get("/:id/drafts", async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "not_found" }, 404);
    const items = (await draftsOf(deps.sql, id)).map((d) => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
    }));
    return c.json({ items } satisfies DraftedMessageList);
  });

  decide("approve", approveRecommendation);
  decide("reject", rejectRecommendation);
  return app;
}
