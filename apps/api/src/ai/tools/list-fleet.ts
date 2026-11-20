/**
 * `list_fleet`: the operator's vessels with their IMO and current voyage (number and status),
 * read from the database. No calculation, and no numbers other than the IMO.
 */
import { currentVoyage, loadWorld } from "@pharos/db";
import { type Fact, ListFleetInput, type ToolResult } from "@pharos/shared";
import { dbFact } from "../../facts/core.js";
import { runTool, type ToolContext } from "./common.js";
import { defineTool } from "./define.js";

export const TOOL = "list_fleet";

export function listFleet(ctx: ToolContext, input: ListFleetInput): Promise<ToolResult> {
  return runTool(ctx, TOOL, input, async () => {
    const world = await loadWorld(ctx.sql);
    const facts: Fact[] = [];
    const vessels = [...world.vessels]
      .sort((a, b) => a.id - b.id)
      .map((vessel) => {
        const name = vessel.name;
        const voyage = currentVoyage(world, vessel.id);
        facts.push(
          dbFact(
            TOOL,
            { table: "vessels", rowId: vessel.id, field: "name" },
            `${name}: vessel name`,
            name,
            null,
          ),
          dbFact(
            TOOL,
            { table: "vessels", rowId: vessel.id, field: "imo" },
            `${name}: IMO number`,
            vessel.imo,
            null,
          ),
        );
        if (voyage) {
          facts.push(
            dbFact(
              TOOL,
              { table: "voyages", rowId: voyage.id, field: "voyageNo" },
              `${name}: current voyage number`,
              voyage.voyageNo,
              null,
            ),
            dbFact(
              TOOL,
              { table: "voyages", rowId: voyage.id, field: "status" },
              `${name}: current voyage status`,
              voyage.status,
              null,
            ),
          );
        }
        return {
          name,
          imo: vessel.imo,
          shipType: vessel.shipType,
          voyageNo: voyage?.voyageNo ?? null,
          voyageStatus: voyage?.status ?? null,
        };
      });
    return { facts, data: { vessels } };
  });
}

export const listFleetDef = defineTool({
  name: TOOL,
  description:
    "The operator's fleet: every vessel with its IMO number, ship type and current voyage " +
    "(voyage number and status). Returns citable facts per vessel.",
  inputSchema: ListFleetInput,
  run: listFleet,
});
