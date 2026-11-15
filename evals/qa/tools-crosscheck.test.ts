/**
 * Cross-check of the reference answers against the REAL agent tools on a real database holding
 * the Q&A world: for every required fact of every question, the tool the spec points at must emit
 * a fact with the same label, value and unit. This is what proves the labels in the golden truth
 * are ones the tools emit.
 */
import type { Sql, World } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import type { Fact, ToolResult } from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calculate } from "../../apps/api/src/ai/tools/calculate.js";
import { createToolContext, type ToolContext } from "../../apps/api/src/ai/tools/common.js";
import { getEmissions } from "../../apps/api/src/ai/tools/emissions.js";
import { listFleet } from "../../apps/api/src/ai/tools/list-fleet.js";
import { listQuotes } from "../../apps/api/src/ai/tools/list-quotes.js";
import { planBunkering } from "../../apps/api/src/ai/tools/plan-bunkering.js";
import { getPortCongestion } from "../../apps/api/src/ai/tools/port-congestion.js";
import { planRouteSpeedFacts } from "../../apps/api/src/ai/tools/route-speed.js";
import { getVesselStatus } from "../../apps/api/src/ai/tools/vessel-status.js";
import { prepareAskFixture } from "../../apps/api/src/ask/demo-fixture.js";
import { DEMO_VESSEL, type FactRef, QUESTIONS } from "./questions.js";
import {
  congestionReading,
  insertInjectedShip,
  QA_INJECTED_SHIP,
  QA_NOW,
  qaRealShip,
  qaRealShipWithDraught,
  qaWorld,
  questionText,
  resolveFact,
} from "./reference.js";

const sql = await connectTestDb("qa_golden");

if (!sql) {
  describe("Q&A reference vs the real tools (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("qa_golden")}`, () => {});
  });
}

/** The tool call that returns the fact a (non-calc) reference points at. */
function callFor(
  ctx: ToolContext,
  ref: Exclude<FactRef, { src: "calc" }>,
  world: World,
): Promise<ToolResult> {
  switch (ref.src) {
    case "status":
      return getVesselStatus(ctx, { vessel: ref.vessel });
    case "fleet":
      return listFleet(ctx, {});
    case "quote":
      return listQuotes(ctx, {});
    case "plan":
      return planBunkering(ctx, { vessel: DEMO_VESSEL });
    case "emissions":
      return getEmissions(ctx, { vessel: ref.vessel });
    case "route": {
      if (ref.subject === "fleet") return planRouteSpeedFacts(ctx, { vessel: ref.vessel });
      const mmsi =
        ref.vessel === "real"
          ? qaRealShip(world).mmsi
          : ref.vessel === "realDraught"
            ? qaRealShipWithDraught(world).mmsi
            : QA_INJECTED_SHIP.mmsi;
      return planRouteSpeedFacts(ctx, { vessel: mmsi, destination: "Rotterdam" });
    }
    case "congestion":
      return getPortCongestion(ctx, { port: congestionReading(world, ref.port).port.unlocode });
  }
}

describe.skipIf(!sql)("Q&A reference vs the real tools (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;
  const world = qaWorld();

  beforeAll(async () => {
    await prepareAskFixture(db);
    await insertInjectedShip(db);
  });
  afterAll(async () => {
    await db.end();
  });

  const matches = (f: Fact, want: ReturnType<typeof resolveFact>) => {
    if (f.label !== want.label || f.unit !== want.unit) return false;
    if (typeof want.value === "number") {
      return typeof f.value === "number" && Math.abs(f.value - want.value) <= 1e-6;
    }
    return String(f.value) === want.value;
  };

  /** Runs the tool for a ref in `ctx`, then returns the fact it emitted for it (or fails). */
  async function emitted(ctx: ToolContext, ref: FactRef): Promise<Fact> {
    if (ref.src === "calc") {
      const ids = [];
      for (const operand of ref.operands) ids.push((await emitted(ctx, operand)).id);
      const result = await calculate(ctx, { op: ref.op, operands: ids });
      return result.facts[0] as Fact;
    }
    const want = resolveFact(world, ref);
    const result = await callFor(ctx, ref, world);
    const hit = result.facts.find((f) => matches(f, want));
    expect(
      hit,
      `${JSON.stringify(ref)} -> ${want.label} = ${want.value} ${want.unit}`,
    ).toBeDefined();
    return hit as Fact;
  }

  for (const q of QUESTIONS.filter((x) => x.facts.length > 0)) {
    it(`${q.id}: every required fact is emitted by its tool with the same value`, async () => {
      const ctx = createToolContext({ sql: db, now: () => QA_NOW });
      for (const ref of q.facts) {
        const fact = await emitted(ctx, ref);
        const want = resolveFact(world, ref);
        expect(fact.label).toBe(want.label);
        if (typeof want.value === "number") {
          expect(fact.value as number).toBeCloseTo(want.value, 6);
        } else {
          expect(String(fact.value)).toBe(want.value);
        }
        expect(fact.unit).toBe(want.unit);
      }
    });
  }

  it("a route question names the real ship by the MMSI its facts use", () => {
    const real = qaRealShip(world);
    const text = questionText(world, "{realShip} {injectedShip}");
    expect(text).toContain(`(MMSI ${real.mmsi})`);
    expect(text).toContain(`(MMSI ${QA_INJECTED_SHIP.mmsi})`);
  });

  it("the plan's best option is the demo answer, and the tool agrees", async () => {
    const ctx = createToolContext({ sql: db, now: () => QA_NOW });
    const result = await planBunkering(ctx, { vessel: DEMO_VESSEL });
    expect(
      result.facts.find((f) => f.label === "Best option (lowest total cost, feasible)")?.value,
    ).toBe("MTMLA-kestrel");
  });
});
