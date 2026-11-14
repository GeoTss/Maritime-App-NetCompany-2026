/**
 * Pure, deterministic maritime maths. Every number the app shows is computed here.
 * Rules (enforced by scripts/check-domain-purity.mjs): no network, no LLM SDK,
 * no process.env, no hidden clock (pass `now` in), no randomness.
 */
export const DOMAIN_CODE_VERSION = "0.0.0";
