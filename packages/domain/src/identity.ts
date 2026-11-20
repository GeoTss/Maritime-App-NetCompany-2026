/** Vessel identifiers. */

function imoCheckDigit(firstSix: string): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Number(firstSix[i]) * (7 - i);
  return sum % 10;
}

/** IMO number from its six-digit base: check digit = Σ(first six digits × 7..2) mod 10. */
export function imoWithCheckDigit(base: string): string {
  if (!/^\d{6}$/.test(base)) throw new RangeError("IMO base must be six digits");
  return `${base}${imoCheckDigit(base)}`;
}

/** True for exactly seven digits whose last digit is the IMO check digit of the first six. */
export function isValidImo(imo: string): boolean {
  if (!/^\d{7}$/.test(imo)) return false;
  return imoCheckDigit(imo.slice(0, 6)) === Number(imo[6]);
}
