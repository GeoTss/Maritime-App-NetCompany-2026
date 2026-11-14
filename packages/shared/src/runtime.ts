import { z } from "zod";

/** How the app talks to the model: live calls, live calls that are recorded, or recorded replies only. */
export const LlmMode = z.enum(["live", "record", "replay"]);
export type LlmMode = z.infer<typeof LlmMode>;

/** Whether an external data source is live or served from a recording. */
export const SourceMode = z.enum(["live", "recorded"]);
export type SourceMode = z.infer<typeof SourceMode>;

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  llmMode: LlmMode,
  db: z.enum(["up", "down"]),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
