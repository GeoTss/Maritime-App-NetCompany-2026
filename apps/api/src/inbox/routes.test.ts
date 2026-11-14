import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Sql, seedDatabase } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { DeliverResult, UploadResult } from "@pharos/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Extractor } from "../ai/extract.js";
import { createApp } from "../app.js";
import { createFixtureSource, FIXTURE_ANCHOR, FIXTURE_SEED } from "../read/fixtures.js";
import { DEMO_INBOX_DIR, type InboxDeps } from "./routes.js";

const FILES = ["01-kestrel-marsaxlokk.eml", "02-straitline-gibraltar.eml"];

it("DEMO_INBOX_DIR is the repo's fixtures/demo-inbox", () => {
  expect(DEMO_INBOX_DIR).toBe(
    fileURLToPath(new URL("../../../../fixtures/demo-inbox", import.meta.url)),
  );
});

const sql = await connectTestDb("inbox_routes");

if (!sql) {
  describe("inbox routes (Postgres)", () => {
    it.skip(`all tests skipped: Postgres unreachable for ${testDbLabel("inbox_routes")}`, () => {});
  });
}

describe.skipIf(!sql)("inbox routes (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  let inboxDir: string;
  let background: Promise<void>[];
  let extracted: string[];

  const extractor: Extractor = {
    model: "claude-haiku-5-5",
    promptVersion: "extract-quote/v1",
    async extract(doc) {
      extracted.push(doc.subject ?? "");
      return {
        output: { kind: "not_a_quote", reason: "test double", evidence: null },
        metrics: [],
      };
    },
  };

  const app = () => {
    const inbox: InboxDeps = {
      sql: db,
      extractor,
      inboxDir,
      track: (p) => {
        background.push(p);
      },
    };
    return createApp({
      llmMode: "replay",
      pingDb: async () => true,
      read: createFixtureSource(),
      inbox,
    });
  };

  beforeEach(async () => {
    await seedDatabase(db, { seed: FIXTURE_SEED, anchor: FIXTURE_ANCHOR, mode: "reset" });
    inboxDir = await mkdtemp(join(tmpdir(), "pharos-inbox-"));
    for (const f of FILES) await copyFile(join(DEMO_INBOX_DIR, f), join(inboxDir, f));
    background = [];
    extracted = [];
  });
  afterEach(async () => {
    await rm(inboxDir, { recursive: true, force: true });
  });
  afterAll(async () => {
    await db.end();
  });

  const upload = (body: Uint8Array | string, type = "message/rfc822") =>
    app().request("/api/inbox/upload", {
      method: "POST",
      headers: { "content-type": type },
      body,
    });

  it("POST /api/inbox/upload stores the email, returns 202 UploadResult and processes it in the background", async () => {
    const raw = new Uint8Array(await readFile(join(inboxDir, FILES[0] ?? "")));
    const res = await upload(raw);
    expect(res.status).toBe(202);
    const first = UploadResult.parse(await res.json());
    expect(first.duplicate).toBe(false);
    expect(background).toHaveLength(1);
    await Promise.all(background);
    expect(extracted).toEqual(["LSMGO offer - MV Aegean Pioneer - Marsaxlokk"]);
    const [ex] = await db`select status from extractions where document_id = ${first.documentId}`;
    expect(ex?.status).toBe("not_a_quote");

    const again = await upload(raw, "application/octet-stream");
    expect(again.status).toBe(202);
    expect(UploadResult.parse(await again.json())).toEqual({
      documentId: first.documentId,
      duplicate: true,
    });
    expect(background).toHaveLength(1);
  });

  it("rejects other content types and an empty body", async () => {
    const wrongType = await upload("From: a@b.example\r\n\r\nhi", "application/json");
    expect(wrongType.status).toBe(415);
    expect(await wrongType.json()).toEqual({ error: "unsupported_media_type" });
    const empty = await upload(new Uint8Array());
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: "invalid_email" });
  });

  it("POST /api/inbox/deliver-next delivers the demo emails in name order, then 409 inbox_empty", async () => {
    const r1 = await app().request("/api/inbox/deliver-next", { method: "POST" });
    expect(r1.status).toBe(202);
    const d1 = DeliverResult.parse(await r1.json());
    expect(d1).toMatchObject({ duplicate: false, remaining: 1 });

    const r2 = await app().request("/api/inbox/deliver-next", { method: "POST" });
    expect(r2.status).toBe(202);
    const d2 = DeliverResult.parse(await r2.json());
    expect(d2).toMatchObject({ duplicate: false, remaining: 0 });
    expect(d2.documentId).not.toBe(d1.documentId);

    const r3 = await app().request("/api/inbox/deliver-next", { method: "POST" });
    expect(r3.status).toBe(409);
    expect(await r3.json()).toEqual({ error: "inbox_empty" });

    await Promise.all(background);
    expect(extracted).toEqual([
      "LSMGO offer - MV Aegean Pioneer - Marsaxlokk",
      "Quotation Gibraltar - MV Aegean Pioneer (PDF attached)",
    ]);
    const docs = await db`select source from documents order by id`;
    expect(docs.map((d) => d.source)).toEqual(["demo_inbox", "demo_inbox"]);
  });

  it("deliver-next skips a demo email that was already uploaded", async () => {
    await upload(new Uint8Array(await readFile(join(inboxDir, FILES[0] ?? ""))));
    const res = await app().request("/api/inbox/deliver-next", { method: "POST" });
    expect(res.status).toBe(202);
    expect(DeliverResult.parse(await res.json())).toMatchObject({ duplicate: false, remaining: 0 });
    await Promise.all(background);
    expect(extracted[1]).toBe("Quotation Gibraltar - MV Aegean Pioneer (PDF attached)");
  });
});
