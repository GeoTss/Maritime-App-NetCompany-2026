/**
 * Server-side refusal fallbacks, shared by both prompts. Sent only when `LLM_FALLBACKS=on` and the
 * model is an Opus model: Haiku 5.5 has no server-side fallback, so `LLM_FALLBACKS` defaults off.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Whether a request to `model` carries `betas: [FALLBACK_BETA]` and `fallbacks: "default"`. */
export const usesFallbacks = (model: string, enabled: boolean): boolean =>
  enabled && model.startsWith("claude-opus");
