/**
 * Truth-level facts for a generated security quote (Track 3), drawn from the eval world with the
 * case's PRNG before anything is rendered. Ranges (illustrative, labelled in the spec and plan):
 * a team of 3–6 guards, a day rate of USD 900–1,600 per team per day, fixed fees (embarkation,
 * disembarkation, arms storage) of USD 3,000–8,000, a minimum of 3–7 days; an EUR quote draws the
 * same USD ranges converted at the world's latest EURUSD rate. The provider is a seeded security
 * provider; the vessel is a fleet vessel; the team boards at Fujairah (or Djibouti) and leaves at
 * one of Djibouti, Suez, Durban or Cape Town. Received 2–44 h before the anchor, valid 2–6 days.
 */
import type { World } from "@pharos/db";
import type { Currency, Port, SecurityProvider, TruthSecurityQuote, Vessel } from "@pharos/shared";
import { type Prng, prngInt, prngPick } from "./prng.js";
import { addDays, isoDay } from "./templates/phrasing.js";
import { EVAL_ANCHOR, eurUsd } from "./world.js";

/** Where a team boards (weighted: most transits start at Fujairah). */
export const EMBARK_POINTS = ["AEFJR", "AEFJR", "AEFJR", "DJJIB"] as const;
/** Where it leaves the ship: after the Gulf of Aden (Djibouti, Suez) or the Somali Basin. */
export const DISEMBARK_POINTS = ["DJJIB", "EGSUZ", "ZADUR", "ZACPT"] as const;

/** The generation ranges in USD; an EUR quote converts them at the latest EURUSD rate. */
export const SECURITY_RANGES = {
  teamSize: [3, 6],
  dayRateUsd: [900, 1600],
  dayRateStep: 25,
  fixedFeesUsd: [3000, 8000],
  fixedFeesStep: 250,
  minDays: [3, 7],
  validDays: [2, 6],
} as const;

export interface SecurityFacts {
  provider: SecurityProvider;
  vessel: Vessel;
  embark: Port;
  /** Null only in the hard case that leaves the disembarkation point open. */
  disembark: Port | null;
  teamSize: number;
  currency: Currency;
  dayRate: number;
  fixedFees: number;
  minDays: number;
  receivedAt: Date;
  validUntil: string | null;
}

export function portByCode(world: World, unlocode: string): Port {
  const port = world.ports.find((p) => p.unlocode === unlocode);
  if (!port) throw new Error(`no port ${unlocode} in the world`);
  return port;
}

export function providerByName(world: World, name: string): SecurityProvider {
  const provider = world.securityProviders.find((p) => p.name === name);
  if (!provider) throw new Error(`no security provider ${name} in the world`);
  return provider;
}

/** A whole multiple of `step` inside [minUsd, maxUsd] converted to `currency`. */
function drawAmount(
  prng: Prng,
  [minUsd, maxUsd]: readonly [number, number],
  step: number,
  usdPerUnit: number,
): number {
  const lo = Math.ceil(minUsd / usdPerUnit / step);
  const hi = Math.floor(maxUsd / usdPerUnit / step);
  return step * prngInt(prng, lo, hi);
}

export function drawSecurityFacts(
  prng: Prng,
  world: World,
  opts: { currency: Currency },
): SecurityFacts {
  const r = SECURITY_RANGES;
  const provider = prngPick(prng, world.securityProviders);
  const vessel = prngPick(prng, world.vessels);
  const embark = portByCode(world, prngPick(prng, EMBARK_POINTS));
  const disembark = portByCode(
    world,
    prngPick(
      prng,
      DISEMBARK_POINTS.filter((c) => c !== embark.unlocode),
    ),
  );
  const rate = opts.currency === "USD" ? 1 : eurUsd(world);
  const teamSize = prngInt(prng, r.teamSize[0], r.teamSize[1]);
  const dayRate = drawAmount(prng, r.dayRateUsd, r.dayRateStep, rate);
  const fixedFees = drawAmount(prng, r.fixedFeesUsd, r.fixedFeesStep, rate);
  const minDays = prngInt(prng, r.minDays[0], r.minDays[1]);
  // Received between 44 h and 2 h before the anchor, on a whole minute.
  const receivedAt = new Date(EVAL_ANCHOR.getTime() - prngInt(prng, 120, 44 * 60) * 60_000);
  const firstDay = [isoDay(receivedAt), isoDay(EVAL_ANCHOR)].sort().at(-1) as string;
  const validUntil = addDays(firstDay, prngInt(prng, r.validDays[0], r.validDays[1]));
  return {
    provider,
    vessel,
    embark,
    disembark,
    teamSize,
    currency: opts.currency,
    dayRate,
    fixedFees,
    minDays,
    receivedAt,
    validUntil,
  };
}

/** The truth a perfect transcription plus Pharos's normalisers yields for these facts. */
export function securityTruthFromFacts(f: SecurityFacts): TruthSecurityQuote {
  return {
    provider: f.provider.name,
    vesselImo: f.vessel.imo,
    embarkUnlocode: f.embark.unlocode,
    disembarkUnlocode: f.disembark?.unlocode ?? null,
    teamSize: f.teamSize,
    dayRate: f.dayRate,
    currency: f.currency,
    fixedFees: f.fixedFees,
    minDays: f.minDays,
    validUntil: f.validUntil,
  };
}
