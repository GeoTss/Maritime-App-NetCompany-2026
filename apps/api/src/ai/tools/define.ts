/**
 * What one agent tool is: its name, the description and input schema the model sees, and the
 * function that runs it. Kept apart from the registry so tool files can import it without a cycle.
 */
import type { AgentToolName, ToolResult } from "@pharos/shared";
import type { z } from "zod";
import type { ToolContext } from "./common.js";

export interface AgentToolDef<S extends z.ZodType> {
  name: AgentToolName;
  description: string;
  inputSchema: S;
  /** Runs the tool through `runTool`, so every call is logged and its facts reach the ledger. */
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolResult>;
}

/** Identity; it types a definition so a mismatch between schema and `run` fails to compile. */
export function defineTool<S extends z.ZodType>(def: AgentToolDef<S>): AgentToolDef<S> {
  return def;
}
