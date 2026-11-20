/**
 * Inbox intake: upload a raw .eml, or deliver the next demo email. Both store the document and
 * answer 202 at once; extraction runs in the background and the console polls its status.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeliverResult, UploadResult } from "@pharos/shared";
import { Hono } from "hono";
import { requireContentType } from "../http/require-content-type.js";
import { EmailParseError } from "../ingest/parse-email.js";
import { type IngestDeps, ingestRaw, processDocument } from "../ingest/workflow.js";

/** The demo inbox directory, from this file's location (not the process cwd). */
export const DEMO_INBOX_DIR = fileURLToPath(
  new URL("../../../../fixtures/demo-inbox", import.meta.url),
);

/** Largest accepted upload. */
export const MAX_EMAIL_BYTES = 10 * 1024 * 1024;

/**
 * Raw .eml bodies only: neither type can be sent by a cross-site form (multipart/form-data can,
 * and this handler does not parse it), so the CSRF guard needs no more than this.
 */
const UPLOAD_TYPES = ["message/rfc822", "application/octet-stream"];

export interface InboxDeps extends IngestDeps {
  /** Directory of demo `.eml` files, delivered in file-name order. */
  inboxDir: string;
  /** Receives each background processing promise (it never rejects). Tests await them. */
  track?: (processing: Promise<void>) => void;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function createInboxRoutes(deps: InboxDeps) {
  const app = new Hono();

  const ingest = async (raw: Uint8Array, source: "upload" | "demo_inbox") => {
    const result = await ingestRaw(deps, raw, source);
    if (!result.duplicate) {
      const processing = processDocument(deps, result.documentId);
      deps.track?.(processing);
    }
    return result;
  };

  app.post("/upload", requireContentType(...UPLOAD_TYPES), async (c) => {
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (raw.byteLength > MAX_EMAIL_BYTES) return c.json({ error: "payload_too_large" }, 413);
    try {
      const { documentId, duplicate } = await ingest(raw, "upload");
      const body: UploadResult = { documentId, duplicate };
      return c.json(body, 202);
    } catch (err) {
      if (err instanceof EmailParseError) {
        return c.json({ error: "invalid_email", message: err.message }, 400);
      }
      throw err;
    }
  });

  app.post("/deliver-next", requireContentType("application/json"), async (c) => {
    const names = (await readdir(deps.inboxDir)).filter((f) => f.endsWith(".eml")).sort();
    const files = await Promise.all(
      names.map(async (name) => {
        const raw = new Uint8Array(await readFile(join(deps.inboxDir, name)));
        return { raw, sha256: sha256(raw) };
      }),
    );
    if (files.length === 0) return c.json({ error: "inbox_empty" }, 409);
    const known = new Set(
      (
        await deps.sql<{ sha256: string }[]>`
          select sha256 from documents where sha256 in ${deps.sql(files.map((f) => f.sha256))}`
      ).map((r) => r.sha256),
    );
    const pending = files.filter((f) => !known.has(f.sha256));
    const next = pending[0];
    if (!next) return c.json({ error: "inbox_empty" }, 409);
    const { documentId, duplicate } = await ingest(next.raw, "demo_inbox");
    const body: DeliverResult = { documentId, duplicate, remaining: pending.length - 1 };
    return c.json(body, 202);
  });

  return app;
}
