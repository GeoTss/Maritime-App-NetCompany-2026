import type { CheckResult } from "@pharos/shared";

/** The API counts lines from 0; the desk reads "Line 1". Display only. */
export function oneBasedLines(text: string): string {
  return text.replace(/\bline (\d+)/gi, (_, n: string) => `line ${Number(n) + 1}`);
}

const LINE = String.raw`line (\d+)`;
const lineNo = (n: string | undefined) => Number(n) + 1;

function unitKnown(r: CheckResult): string {
  const detail = r.detail ?? "";
  const price = new RegExp(`Price of ${LINE} is not per mt \\("([^"]*)"\\)`, "i").exec(detail);
  if (price) {
    return `Line ${lineNo(price[1])}: the price unit “${price[2]}” was not recognised. Confirm it is per tonne.`;
  }
  const qty = new RegExp(`Quantity unit "([^"]*)" of ${LINE} is not a mass unit`, "i").exec(detail);
  if (qty) {
    return `Line ${lineNo(qty[2])}: the quantity unit “${qty[1]}” was not recognised. Confirm it is a mass unit.`;
  }
  return oneBasedLines(detail);
}

function quantityUnambiguous(r: CheckResult): string {
  const detail = r.detail ?? "";
  const m = new RegExp(`Quantity of ${LINE} is not a single amount \\("([^"]*)"\\)`, "i").exec(
    detail,
  );
  if (m) return `Line ${lineNo(m[1])}: the quantity “${m[2]}” is not one amount.`;
  return oneBasedLines(detail);
}

/** Plain-language messages for the checks the desk meets most; others show the API's detail. */
export const CHECK_COPY: Record<string, (r: CheckResult) => string> = {
  unit_known: unitKnown,
  quantity_unambiguous: quantityUnambiguous,
};

/** The message to show for a check: its plain copy, else the API detail with 1-based line numbers. */
export function checkMessage(r: CheckResult): string | null {
  if (!r.detail) return null;
  const copy = CHECK_COPY[r.check.split(":")[0] ?? r.check];
  return copy ? copy(r) : oneBasedLines(r.detail);
}
