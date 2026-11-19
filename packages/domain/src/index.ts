/**
 * Pure, deterministic maritime maths. Every number the app shows is computed here.
 * Rules (enforced by scripts/check-domain-purity.mjs): no network, no LLM SDK,
 * no process.env, no hidden clock (pass `now` in), no randomness.
 */
export const DOMAIN_CODE_VERSION = "0.9.0";
export * from "./areas.js";
export * from "./bunker-planner.js";
export * from "./bunker-stop.js";
export * from "./calculate.js";
export * from "./coast.js";
export * from "./congestion.js";
export * from "./constants.js";
export * from "./consumption.js";
export * from "./dates.js";
export * from "./eca.js";
export * from "./emissions.js";
export * from "./fob.js";
export * from "./fueleu.js";
export * from "./geo.js";
export * from "./hazards.js";
export * from "./identity.js";
export * from "./load.js";
export * from "./normalise.js";
export * from "./port-call.js";
export * from "./price-band.js";
export * from "./route-graph.js";
export * from "./route-optimiser.js";
export * from "./security.js";
export * from "./stop-plan.js";
export * from "./storms.js";
export * from "./track.js";
export * from "./track-fuel.js";
export * from "./units.js";
export * from "./voyage.js";
export * from "./weather-effect.js";
