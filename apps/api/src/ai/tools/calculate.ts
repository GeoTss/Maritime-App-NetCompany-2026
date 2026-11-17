/**
 * `calculate`: arithmetic over facts the conversation already holds. The model chooses only the
 * operation and the operand fact ids; the values come from the ledger, the domain `calculate`
 * computes, and the result is stored as a calculation with its operand lineage. It returns one
 * derived fact, `f_calc:<calculationId>:value`, that an answer cites like any other.
 */
import { CalcError, calculate as domainCalculate } from "@pharos/domain";
import { CalculateInput, type Fact, type FactId, type ToolResult } from "@pharos/shared";
import { insertCalculation, runTool, type ToolContext } from "./common.js";
import { defineTool } from "./define.js";

export const TOOL = "calculate";

/** The derived fact id of a `calculate` result. */
export const calcFactId = (calculationId: number): FactId => `f_calc:${calculationId}:value`;

/** Each operand id as a numeric ledger fact; an unknown or non-numeric id is a tool error. */
function numericOperands(ctx: ToolContext, ids: FactId[]): (Fact & { value: number })[] {
  const unknown = ids.filter((id) => !ctx.ledger.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Operands ${unknown.join(", ")} were not returned earlier in this conversation; ` +
        "use fact ids exactly as a tool returned them.",
    );
  }
  const facts = ids.map((id) => ctx.ledger.get(id) as Fact);
  const notNumbers = facts.filter((f) => typeof f.value !== "number");
  if (notNumbers.length > 0) {
    throw new Error(
      `Operands ${notNumbers.map((f) => f.id).join(", ")} are not a number; calculate takes numeric facts only.`,
    );
  }
  return facts as (Fact & { value: number })[];
}

export function calculate(ctx: ToolContext, input: CalculateInput): Promise<ToolResult> {
  return runTool(ctx, TOOL, input, async () => {
    const { op, operands: ids } = CalculateInput.parse(input);
    const operands = numericOperands(ctx, ids);
    let result: { value: number; unit: string | null };
    try {
      result = domainCalculate(
        op,
        operands.map((f) => ({ value: f.value, unit: f.unit })),
      );
    } catch (err) {
      if (err instanceof CalcError)
        throw new Error(`calculate failed (${err.code}): ${err.message}`);
      throw err;
    }

    const calculationId = await insertCalculation(ctx, {
      kind: "calculate",
      inputs: {
        op,
        operands: operands.map((f) => ({ factId: f.id, value: f.value, unit: f.unit })),
      },
      outputs: result,
      voyageId: null,
      operandFactIds: ids,
    });
    const fact: Fact = {
      id: calcFactId(calculationId),
      label: `${op} of ${operands.map((f) => f.label).join(" and ")}`,
      value: result.value,
      unit: result.unit,
      provenance: { source: "derived", operation: op, operands: ids },
    };
    return { facts: [fact], data: { calculationId, factId: fact.id, op, operands: ids } };
  });
}

export const calculateDef = defineTool({
  name: TOOL,
  description:
    "Arithmetic over facts returned earlier in this conversation, for any sum, difference, ratio " +
    "or percentage the operator asks for. Pass the operation and the operand fact ids (never " +
    "typed numbers); subtract is a - b, divide a / b, difference |a - b|, percent_change " +
    "(b - a) / a in %. Units must agree for add, subtract, difference, sum, min and max. " +
    "A percentage difference is one percent_change call: cite the fact it returns and do not " +
    "also divide. Returns one derived fact to cite.",
  inputSchema: CalculateInput,
  run: calculate,
});
