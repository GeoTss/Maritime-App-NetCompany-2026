/**
 * Entity resolution and business-rule lookups for an extracted quote, over the loaded world.
 * Pure: no database access, no clock. Every resolver returns null (with a reason) rather than
 * guessing when a match is missing or ambiguous.
 */
import type { World } from "@pharos/db";
import { PRICE_BAND_FRACTION, priceWithinBand, toUsd } from "@pharos/domain";
import type { Currency, FuelGrade, Port, PortFuelPrice, Supplier, Vessel } from "@pharos/shared";

const fold = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "MV Aegean Pioneer", "M/V AEGEAN PIONEER", "Aegean Pioneer" -> "aegean pioneer". */
function vesselKey(name: string): string {
  return fold(name).replace(/^(?:m\/?v|m\/?t|mt|mv)\.?\s+/, "");
}

export function resolveVessel(
  world: World,
  written: { name: string | null; imo: string | null },
): { vessel: Vessel | null; detail: string | null } {
  const name = written.name?.trim() || null;
  const imoDigits = written.imo?.match(/\d{7}/g);
  if (written.imo?.trim() && imoDigits?.length !== 1) {
    return { vessel: null, detail: `IMO "${written.imo}" is not a single 7-digit number.` };
  }
  const imo = imoDigits?.[0] ?? null;
  if (!name && !imo) return { vessel: null, detail: "No vessel name or IMO in the quote." };

  const byImo = imo ? world.vessels.find((v) => v.imo === imo) : undefined;
  if (imo && !byImo) return { vessel: null, detail: `No fleet vessel has IMO ${imo}.` };
  const byName = name ? world.vessels.filter((v) => vesselKey(v.name) === vesselKey(name)) : [];
  if (name && byName.length > 1) {
    return { vessel: null, detail: `Vessel name "${name}" matches more than one fleet vessel.` };
  }
  if (byImo) {
    if (name && byName[0]?.id !== byImo.id) {
      return {
        vessel: null,
        detail: `Vessel name "${name}" does not match IMO ${imo} (${byImo.name}).`,
      };
    }
    return { vessel: byImo, detail: null };
  }
  const only = byName[0];
  return only
    ? { vessel: only, detail: null }
    : { vessel: null, detail: `No fleet vessel is named "${name}".` };
}

export function resolvePort(
  world: World,
  written: string | null,
): { port: Port | null; detail: string | null } {
  const key = written ? fold(written) : "";
  if (key === "") return { port: null, detail: "No port in the quote." };
  const exact = world.ports.filter((p) => fold(p.name) === key || p.unlocode.toLowerCase() === key);
  // Suppliers write the port with a location ("Antwerp outer anchorage", "Rotterdam (NLRTM)",
  // "Port of Piraeus"): accept the one known port whose name or UN/LOCODE appears as whole
  // words; two different ports named in the text stay ambiguous (review).
  const hits =
    exact.length > 0
      ? exact
      : world.ports.filter((p) =>
          [fold(p.name), p.unlocode.toLowerCase()].some((needle) =>
            new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, "u").test(
              key,
            ),
          ),
        );
  if (hits.length === 1 && hits[0]) return { port: hits[0], detail: null };
  return {
    port: null,
    detail:
      hits.length === 0
        ? `No known port is called "${written}".`
        : `Port "${written}" is ambiguous.`,
  };
}

/** By the sender address's domain, which must equal a supplier's `emailDomain` exactly. */
export function resolveSupplier(
  world: World,
  sender: string | null,
): { supplier: Supplier | null; detail: string | null } {
  const at = sender?.lastIndexOf("@") ?? -1;
  if (!sender || at < 0) return { supplier: null, detail: "The email has no sender address." };
  const domain = sender
    .slice(at + 1)
    .trim()
    .toLowerCase();
  const supplier = world.suppliers.find((s) => s.emailDomain.toLowerCase() === domain);
  return supplier
    ? { supplier, detail: null }
    : { supplier: null, detail: `Sender domain "${domain}" is not a known supplier.` };
}

/**
 * The supplier a name in the text refers to: the case- and whitespace-folded name equals a
 * supplier's full name, or is a prefix of it that ends on a word boundary ("Kestrel" names
 * "Kestrel Marine Fuels"; "Kes" and "Kestrel Marine Fuels Ltd" name nobody). Null unless exactly
 * one supplier matches.
 */
export function resolveSupplierName(world: World, written: string | null): Supplier | null {
  const key = written ? fold(written) : "";
  if (key === "") return null;
  const hits = world.suppliers.filter((s) => {
    const full = fold(s.name);
    return full.startsWith(key) && !/[\p{L}\p{N}]/u.test(full[key.length] ?? "");
  });
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

const latestBy = <T>(rows: T[], at: (r: T) => Date): T | null =>
  rows.reduce<T | null>((best, r) => (best === null || at(r) > at(best) ? r : best), null);

export function latestMarketPrice(
  world: World,
  portId: number,
  grade: FuelGrade,
): PortFuelPrice | null {
  return latestBy(
    world.portFuelPrices.filter((p) => p.portId === portId && p.grade === grade),
    (p) => p.asOf,
  );
}

/** USD per unit of `currency` from the latest fx reference rate; USD is 1. */
export function latestUsdRate(world: World, currency: Currency): number | null {
  if (currency === "USD") return 1;
  const rate = latestBy(
    world.referenceRates.filter((r) => r.kind === "fx" && r.key === `${currency}USD`),
    (r) => r.asOf,
  );
  return rate?.value ?? null;
}

/**
 * Looks up the port's latest market price and fx rate, then asks the domain whether the quoted
 * price per mt lies within the band (±15 %) of the market price in USD.
 */
export function checkPriceBand(
  world: World,
  portId: number,
  grade: FuelGrade,
  pricePerMt: number,
  currency: Currency,
): { passed: boolean; detail: string | null } {
  const market = latestMarketPrice(world, portId, grade);
  if (!market) return { passed: false, detail: `No ${grade} market price for this port.` };
  const rate = latestUsdRate(world, currency);
  if (rate === null) return { passed: false, detail: `No ${currency}USD reference rate.` };
  const band = priceWithinBand(toUsd(pricePerMt, rate), market.priceUsdPerMt, PRICE_BAND_FRACTION);
  return band.withinBand
    ? { passed: true, detail: null }
    : {
        passed: false,
        detail: `${grade} ${currency} ${pricePerMt}/mt is outside ±15 % of the market price.`,
      };
}
