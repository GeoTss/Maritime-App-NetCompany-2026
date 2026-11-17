import type { Sql } from "@pharos/db";
import { connectTestDb, testDbLabel } from "@pharos/db/testing";
import { AgentToolName } from "@pharos/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASK_FIXTURE_NOW, prepareAskFixture } from "../../ask/demo-fixture.js";
import { createToolContext } from "./common.js";
import { AGENT_TOOL_DEFS, agentTools } from "./registry.js";

describe("tool registry", () => {
  it("registry order matches AgentToolName", () => {
    expect(AGENT_TOOL_DEFS.map((d) => d.name)).toEqual(AgentToolName.options);
  });
});

const sql = await connectTestDb("ask_registry");

if (!sql) {
  describe("tool registry (Postgres)", () => {
    it.skip(`skipped: Postgres unreachable for ${testDbLabel("ask_registry")}`, () => {});
  });
}

describe.skipIf(!sql)("tool registry (Postgres)", () => {
  if (!sql) return;
  const db: Sql = sql;

  beforeAll(async () => {
    await prepareAskFixture(db);
  });
  afterAll(async () => {
    await db.end();
  });

  it("every tool records its call", async () => {
    const ctx = createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
    // Run in registry order; calculate and propose_action take ids earlier calls returned.
    const inputs = (name: string): unknown => {
      switch (name) {
        case "list_fleet":
        case "list_quotes":
          return {};
        case "get_vessel_status":
        case "get_emissions":
        case "plan_route_speed":
          return { vessel: "Aegean Pioneer" };
        case "plan_bunkering":
          return { vessel: "Aegean Pioneer" };
        case "get_port_congestion":
          return { port: "Rotterdam" };
        case "calculate": {
          const operands = [...ctx.ledger.values()]
            .filter((f) => typeof f.value === "number" && f.unit === "mt")
            .slice(0, 2)
            .map((f) => f.id);
          return { op: "add", operands };
        }
        default: {
          const plan = [...ctx.ledger.values()].filter((f) => f.id.endsWith("_bestOptionId"))[0];
          const calc = [...ctx.ledger.values()].find((f) => f.id.endsWith("calculationId"));
          return {
            type: "purchase_order",
            calculationId: calc?.value,
            optionId: plan?.value,
            factRefs: plan ? [plan.id] : [],
            rationale: "Cheapest feasible option.",
          };
        }
      }
    };
    for (const def of AGENT_TOOL_DEFS) {
      const before = ctx.calls.length;
      const input = def.inputSchema.parse(inputs(def.name));
      await def.run(ctx, input).catch(() => {});
      expect(ctx.calls.length - before, def.name).toBe(1);
      expect(ctx.calls.at(-1)?.tool).toBe(def.name);
    }
  });

  it("agentTools wraps each def, in order, with the JSON result", async () => {
    const ctx = createToolContext({ sql: db, now: () => ASK_FIXTURE_NOW });
    const tools = agentTools(ctx) as unknown as {
      name: string;
      run: (i: unknown) => Promise<string>;
    }[];
    expect(tools.map((t) => t.name)).toEqual(AgentToolName.options);
    const text = await tools[0]?.run({});
    expect(JSON.parse(text ?? "")).toHaveProperty("facts");
  });
});
