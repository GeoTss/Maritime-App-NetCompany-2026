/**
 * Pure, deterministic maritime maths. Every number the app shows is computed here.
 * Rules (enforced by scripts/check-domain-purity.mjs): no network, no LLM SDK,
 * no process.env, no hidden clock (pass `now` in), no randomness.
 */
export const DOMAIN_CODE_VERSION = "0.0.0";
export * from "./bunker-planner.js";
export * from "./constants.js";
export * from "./consumption.js";
export * from "./emissions.js";
export * from "./fob.js";
export * from "./geo.js";
export * from "./identity.js";
export * from "./normalise.js";
export * from "./price-band.js";
export * from "./voyage.js";
