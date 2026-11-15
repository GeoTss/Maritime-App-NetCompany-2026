/**
 * The review queue API.
 *
 *   GET  /api/review                     → `{ items: ReviewItem[] }`
 *   GET  /api/review/reference           → `ReviewReference`: the vessels, ports and suppliers the Accept form offers
 *   POST /api/review/:id/accept          body `ReviewCorrection` → `ReviewDecision`
 *   POST /api/review/:id/reject          → `ReviewDecision`
 *   POST /api/review/:id/retry           → `ReviewDecision` (202; the new extraction is `pending`)
 *
 * Every POST needs `application/json` (415 otherwise), even those with no body: a cross-site HTML
 * form can send only form-encoded, multipart or text/plain, so it can never decide anything.
 */
import { ReviewCorrection, ReviewReference } from "@pharos/shared";
import { Hono } from "hono";
import { processDocument } from "../ingest/workflow.js";
import { parseId } from "../read/routes.js";
import {
  acceptExtraction,
  listReviewItems,
  type ReviewDeps,
  ReviewError,
  rejectExtraction,
  retryExtraction,
  reviewReference,
} from "./decide.js";

export interface ReviewRouteDeps extends ReviewDeps {
  /** Receives each background processing promise (it never rejects). Tests await them. */
  track?: (processing: Promise<void>) => void;
}

const STATUS = { not_found: 404, conflict: 409, unprocessable: 422 } as const;

export function createReviewRoutes(deps: ReviewRouteDeps) {
  const app = new Hono();

  app.get("/", async (c) => c.json({ items: await listReviewItems(deps.sql) }));

  // Validated on the way out: the console's Accept form is typed by this contract.
  app.get("/reference", async (c) =>
    c.json(ReviewReference.parse(await reviewReference(deps.sql))),
  );

  const decision = (
    path: "accept" | "reject" | "retry",
    run: (id: number, request: Request) => Promise<Response | unknown>,
  ) =>
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
      try {
        const result = await run(id, c.req.raw);
        return result instanceof Response ? result : c.json(result);
      } catch (err) {
        if (err instanceof ReviewError) {
          return c.json({ error: err.code, message: err.message }, STATUS[err.code]);
        }
        throw err;
      }
    });

  decision("accept", async (id, request) => {
    let raw: unknown;
    try {
      raw = JSON.parse(await request.text());
    } catch {
      return Response.json(
        { error: "invalid_request", message: "Body must be the corrected quote as JSON." },
        { status: 400 },
      );
    }
    const body = ReviewCorrection.safeParse(raw);
    if (!body.success) {
      const message = body.error.issues
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ");
      return Response.json({ error: "invalid_request", message }, { status: 400 });
    }
    return acceptExtraction(deps, id, body.data);
  });

  decision("reject", (id) => rejectExtraction(deps, id));

  decision("retry", async (id) => {
    const { documentId, ...result } = await retryExtraction(deps, id);
    // Not awaited: the page polls the queue and the inbox, as it does after a delivery.
    const processing = processDocument(deps, documentId);
    deps.track?.(processing);
    return Response.json(result, { status: 202 });
  });

  return app;
}
