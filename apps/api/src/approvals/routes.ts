/**
 * `POST /api/recommendations/:id/approve|reject` → `DecisionResult`. The human decision; the
 * executor does the rest. The JSON body (`{}` or `{decidedBy}`, default "operator") names who
 * decided and nothing else: an order's values always come from the stored calculation and quote.
 *
 * Only `application/json` is accepted (415 otherwise): a cross-site HTML form can send only
 * form-encoded, multipart or text/plain bodies, so it can never approve or reject.
 */
import { Hono } from "hono";
import { z } from "zod";
import {
  approveRecommendation,
  DecisionError,
  type ExecutorDeps,
  rejectRecommendation,
} from "../executor/execute.js";
import { parseId } from "../read/routes.js";

export type ApprovalDeps = ExecutorDeps;

export const DEFAULT_DECIDED_BY = "operator";

const DecisionBody = z.object({ decidedBy: z.string().trim().min(1).max(100).optional() }).strict();

export function createApprovalRoutes(deps: ApprovalDeps) {
  const app = new Hono();

  const decide = (path: "approve" | "reject", action: typeof approveRecommendation) =>
    app.post(`/:id/${path}`, async (c) => {
      const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      if (type !== "application/json") {
        return c.json(
          { error: "unsupported_media_type", message: "Send the decision as application/json." },
          415,
        );
      }
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
        throw err;
      }
    });

  decide("approve", approveRecommendation);
  decide("reject", rejectRecommendation);
  return app;
}
