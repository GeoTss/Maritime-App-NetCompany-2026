/**
 * `GET /api/eval/summary` → `EvalSummary`: the published live-run scorecards for the evaluation
 * page. The file is written by `npm run eval:publish` from named live reports (never by the API);
 * this route only reads and validates it. 404 `no_published_summary` while nothing is published;
 * 500 `invalid_published_summary` when the path cannot be read or the file does not parse or validate.
 */
import { readFile } from "node:fs/promises";
import { EvalSummary } from "@pharos/shared";
import { Hono } from "hono";

export interface EvalRouteDeps {
  /** Absolute path of the published summary (DEFAULT_EVAL_SUMMARY_PATH in the server). */
  path: string;
}

export function createEvalRoutes(deps: EvalRouteDeps) {
  const app = new Hono();

  app.get("/summary", async (c) => {
    let text: string;
    try {
      text = await readFile(deps.path, "utf8");
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === "ENOENT") return c.json({ error: "no_published_summary" }, 404);
      // A directory or an unreadable file at the path (EISDIR, EACCES, ...): the same 500 shape.
      return c.json(
        {
          error: "invalid_published_summary",
          message: `The published summary cannot be read (${typeof code === "string" ? code : "read error"}).`,
        },
        500,
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return c.json(
        { error: "invalid_published_summary", message: "The published summary is not JSON." },
        500,
      );
    }
    const parsed = EvalSummary.safeParse(raw);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "summary"}: ${i.message}`)
        .join("; ");
      return c.json({ error: "invalid_published_summary", message }, 500);
    }
    return c.json(parsed.data);
  });

  return app;
}
