import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import * as schema from "./schema.js";
import { connectTestDb, testDbLabel } from "./testing.js";

const sql = await connectTestDb("drafted_messages");

if (!sql) {
  describe("drafted_messages (Postgres)", () => {
    it.skip(`all tests skipped: Postgres unreachable for ${testDbLabel("drafted_messages")}`, () => {});
  });
}

describe.skipIf(!sql)("drafted_messages (Postgres)", () => {
  if (!sql) return;
  const db = createDb(sql);
  afterAll(async () => {
    await sql.end();
  });

  async function newRecommendation(): Promise<number> {
    const now = new Date("2026-11-14T08:00:00Z");
    const [calc] = await db
      .insert(schema.calculations)
      .values({ kind: "calculate", codeVersion: "t", operandFactIds: ["a:1"], createdAt: now })
      .returning();
    const [rec] = await db
      .insert(schema.recommendations)
      .values({
        type: "purchase_order",
        calculationId: calc?.id ?? 0,
        optionId: "o",
        factRefs: [],
        status: "pending",
        createdAt: now,
      })
      .returning();
    if (!rec) throw new Error("no recommendation");
    return rec.id;
  }

  const draft = (
    recommendationId: number,
    kind: "supplier_confirmation" | "master_instruction",
  ) => ({
    recommendationId,
    kind,
    to: "x@example.com",
    subject: "s",
    body: "b",
    createdAt: new Date("2026-11-14T08:00:00Z"),
  });

  it("defaults status to draft and rejects a second draft of the same kind", async () => {
    const rec = await newRecommendation();
    const [first] = await db
      .insert(schema.draftedMessages)
      .values(draft(rec, "supplier_confirmation"))
      .returning();
    expect(first?.status).toBe("draft");
    await expect(
      db.insert(schema.draftedMessages).values(draft(rec, "supplier_confirmation")),
    ).rejects.toThrow();
    // A different kind for the same recommendation is fine.
    await db.insert(schema.draftedMessages).values(draft(rec, "master_instruction"));
  });

  it("messages.gate_attempts defaults to [] and calculations.operand_fact_ids round-trips", async () => {
    const [conv] = await db
      .insert(schema.conversations)
      .values({ createdAt: new Date() })
      .returning();
    const [msg] = await db
      .insert(schema.messages)
      .values({ conversationId: conv?.id ?? 0, role: "assistant", createdAt: new Date() })
      .returning();
    expect(msg?.gateAttempts).toEqual([]);
    const [calc] = await db
      .insert(schema.calculations)
      .values({ kind: "fob_projection", codeVersion: "t", createdAt: new Date() })
      .returning();
    expect(calc?.operandFactIds).toBeNull();
  });
});
