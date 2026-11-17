/**
 * The agent's tools: one definition each (name, description, input schema, run), collected here in
 * the order the model is offered them. The order is part of every request, so of its replay key:
 * append only. `agentTools` turns the definitions into the tool-runner's tools for one ask.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaToolRunnerParams } from "@anthropic-ai/sdk/lib/tools/BetaToolRunner";
import type { z } from "zod";
import { calculateDef } from "./calculate.js";
import type { ToolContext } from "./common.js";
import { type AgentToolDef, defineTool } from "./define.js";
import { emissionsDef } from "./emissions.js";
import { listFleetDef } from "./list-fleet.js";
import { listQuotesDef } from "./list-quotes.js";
import { planBunkeringDef } from "./plan-bunkering.js";
import { portCongestionDef } from "./port-congestion.js";
import { proposeActionDef } from "./propose-action.js";
import { planRouteSpeedDef } from "./route-speed.js";
import { vesselStatusDef } from "./vessel-status.js";

export { type AgentToolDef, defineTool };

export type AgentTools = BetaToolRunnerParams["tools"];

/** Same order as `AgentToolName`. */
export const AGENT_TOOL_DEFS: readonly AgentToolDef<z.ZodType>[] = [
  listFleetDef,
  vesselStatusDef,
  listQuotesDef,
  planBunkeringDef,
  emissionsDef,
  planRouteSpeedDef,
  portCongestionDef,
  calculateDef,
  proposeActionDef,
] as readonly AgentToolDef<z.ZodType>[];

/** The tool-runner tools for one ask: each definition bound to the ask's context. */
export function agentTools(ctx: ToolContext): AgentTools {
  return AGENT_TOOL_DEFS.map((def) =>
    betaZodTool({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      run: async (input) => JSON.stringify(await def.run(ctx, input)),
    }),
  ) as AgentTools;
}
