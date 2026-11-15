import type { CalcOp } from "@pharos/shared";

/** Arithmetic over fact values for the agent's `calculate` tool. Pure; full doubles, rounded only by the caller. */
export type CalcErrorCode = "unit_mismatch" | "divide_by_zero" | "arity" | "non_finite";

export class CalcError extends Error {
  readonly code: CalcErrorCode;
  constructor(code: CalcErrorCode, message: string) {
    super(message);
    this.name = "CalcError";
    this.code = code;
  }
}

export interface CalcOperand {
  value: number;
  unit: string | null;
}

/** Same counts as CalculateInput in @pharos/shared (1-10 operands; exactly 2 for binary ops). */
const MAX_OPERANDS = 10;
const BINARY: readonly CalcOp[] = ["subtract", "divide", "difference", "percent_change"];

const fold = (u: string | null): string | null => (u === null ? null : u.toLowerCase());

function sameUnit(op: CalcOp, operands: readonly CalcOperand[]): string | null {
  const first = operands[0] as CalcOperand;
  for (const o of operands) {
    if (fold(o.unit) !== fold(first.unit)) {
      throw new CalcError(
        "unit_mismatch",
        `${op} needs identical units, got ${first.unit ?? "none"} and ${o.unit ?? "none"}`,
      );
    }
  }
  return first.unit;
}

function finite(n: number): number {
  if (!Number.isFinite(n)) throw new CalcError("non_finite", "result is not a finite number");
  return n;
}

export function calculate(op: CalcOp, operands: readonly CalcOperand[]): CalcOperand {
  if (operands.length < 1 || operands.length > MAX_OPERANDS) {
    throw new CalcError("arity", `${op} takes 1-${MAX_OPERANDS} operands, got ${operands.length}`);
  }
  if (BINARY.includes(op) && operands.length !== 2) {
    throw new CalcError("arity", `${op} takes exactly 2 operands, got ${operands.length}`);
  }
  for (const o of operands) {
    if (!Number.isFinite(o.value)) throw new CalcError("non_finite", "operand is not finite");
  }
  const vals = operands.map((o) => o.value);
  const a = vals[0] as number;
  const b = vals[1] as number;

  switch (op) {
    case "add":
    case "sum": {
      const unit = sameUnit(op, operands);
      return { value: finite(vals.reduce((s, v) => s + v, 0)), unit };
    }
    case "subtract":
      return { value: finite(a - b), unit: sameUnit(op, operands) };
    case "difference":
      return { value: finite(Math.abs(a - b)), unit: sameUnit(op, operands) };
    case "min":
      return { value: Math.min(...vals), unit: sameUnit(op, operands) };
    case "max":
      return { value: Math.max(...vals), unit: sameUnit(op, operands) };
    case "percent_change": {
      sameUnit(op, operands);
      if (a === 0) throw new CalcError("divide_by_zero", "percent_change from a base of 0");
      return { value: finite(((b - a) / a) * 100), unit: "%" };
    }
    case "divide": {
      if (b === 0) throw new CalcError("divide_by_zero", "divide by 0");
      const ua = operands[0]?.unit ?? null;
      const ub = operands[1]?.unit ?? null;
      let unit: string | null;
      if (fold(ua) === fold(ub)) unit = null;
      else if (ub === null) unit = ua;
      else unit = `${ua ?? "1"}/${ub}`;
      return { value: finite(a / b), unit };
    }
    case "multiply": {
      let acc = operands[0] as CalcOperand;
      for (const next of operands.slice(1)) {
        const unit =
          acc.unit === null
            ? next.unit
            : next.unit === null
              ? acc.unit
              : `${acc.unit}·${next.unit}`;
        acc = { value: finite(acc.value * next.value), unit };
      }
      return { value: finite(acc.value), unit: acc.unit };
    }
  }
}
