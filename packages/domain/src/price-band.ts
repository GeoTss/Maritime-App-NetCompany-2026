/**
 * Currency conversion to USD and the market-band check used to flag implausible quoted prices.
 * Pure: rates and market prices are passed in.
 */

/** A quoted price must lie within this fraction of the market price (±15 %). */
export const PRICE_BAND_FRACTION = 0.15;

const finite = (x: number, what: string) => {
  if (!Number.isFinite(x)) throw new RangeError(`${what} must be a finite number`);
};

/** `amount` in a currency worth `usdPerUnit` USD each (USD itself is 1). */
export function toUsd(amount: number, usdPerUnit: number): number {
  finite(amount, "amount");
  finite(usdPerUnit, "usdPerUnit");
  if (usdPerUnit <= 0) throw new RangeError("usdPerUnit must be positive");
  return amount * usdPerUnit;
}

/** |quoted − market| / market, and whether it is at most `fraction` (band edges included). */
export function priceWithinBand(
  quotedUsd: number,
  marketUsd: number,
  fraction: number = PRICE_BAND_FRACTION,
): { withinBand: boolean; deviationFraction: number } {
  finite(quotedUsd, "quotedUsd");
  finite(marketUsd, "marketUsd");
  finite(fraction, "fraction");
  if (marketUsd <= 0) throw new RangeError("marketUsd must be positive");
  if (fraction < 0) throw new RangeError("fraction must not be negative");
  const deviationFraction = Math.abs(quotedUsd - marketUsd) / marketUsd;
  return { withinBand: deviationFraction <= fraction, deviationFraction };
}
