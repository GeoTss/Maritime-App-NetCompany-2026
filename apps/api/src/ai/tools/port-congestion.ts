/**
 * `get_port_congestion`: the latest anchorage congestion reading of a port, from AIS when the
 * worker has one and from the desk's seeded figure otherwise. Read-only.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { loadWorld } from "@pharos/db";
import { type Fact, PortCongestionInput, type ToolResult } from "@pharos/shared";
import { dbFact } from "../../facts/core.js";
import { resolvePort } from "../../ingest/resolve.js";
import { runTool, type ToolContext } from "./common.js";

export const TOOL = "get_port_congestion";

export function getPortCongestion(ctx: ToolContext, input: PortCongestionInput) {
  return runTool(ctx, TOOL, input, async (): Promise<ToolResult> => {
    const world = await loadWorld(ctx.sql);
    const { port, detail } = resolvePort(world, input.port);
    if (!port) throw new Error(detail ?? `No known port is called "${input.port}".`);
    const [row] = await ctx.sql<
      {
        id: number;
        anchored_count: number;
        waiting_hours: number;
        observed_at: string | Date;
        source: "seed" | "ais";
      }[]
    >`select id, anchored_count, waiting_hours, observed_at, source from port_congestion
      where port_id = ${port.id} order by observed_at desc, id desc limit 1`;
    if (!row) throw new Error(`There is no congestion reading for ${port.name}.`);
    const at = (field: string) => ({ table: "port_congestion", rowId: row.id, field });
    const facts: Fact[] = [
      dbFact(
        TOOL,
        at("anchoredCount"),
        `${port.name}: vessels at anchor`,
        row.anchored_count,
        null,
      ),
      dbFact(
        TOOL,
        at("waitingHours"),
        `${port.name}: expected waiting time`,
        row.waiting_hours,
        "h",
      ),
      dbFact(
        TOOL,
        at("observedAt"),
        `${port.name}: congestion observed at (UTC)`,
        new Date(row.observed_at).toISOString(),
        null,
      ),
      dbFact(TOOL, at("source"), `${port.name}: congestion source`, row.source, null),
    ];
    return { facts, data: { port: port.name, unlocode: port.unlocode, source: row.source } };
  });
}

export function portCongestionTool(ctx: ToolContext) {
  return betaZodTool({
    name: TOOL,
    description:
      "Latest congestion at a port: vessels at anchor and expected waiting time, with when and " +
      "from what source it was observed. The figures are observed at the anchorage (AIS) and can " +
      "differ from the desk's planning figures, which bunker plans use. Returns citable facts.",
    inputSchema: PortCongestionInput,
    run: async (input) => JSON.stringify(await getPortCongestion(ctx, input)),
  });
}
