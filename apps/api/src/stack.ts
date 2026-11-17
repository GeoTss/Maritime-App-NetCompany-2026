/**
 * How `server.ts` builds the API: the boot seed (`bootWorld`) and the app with every request path
 * on one clock (`createStackApp`). Kept out of server.ts so tests boot the same wiring.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { pingDb, type Sql, seedDatabase } from "@pharos/db";
import { createLlmExtractor } from "./ai/extract.js";
import { createApp } from "./app.js";
import type { Clock } from "./clock.js";
import { type AppConfig, ConfigError, DEFAULT_EVAL_SUMMARY_PATH } from "./config.js";
import { createErpClient, type ErpClient } from "./executor/erp-client.js";
import { DEMO_INBOX_DIR, type InboxDeps } from "./inbox/routes.js";
import { createDbSource } from "./read/db-source.js";

/**
 * Seeds (or keeps) the world as SEED_ON_BOOT says: anchored at DEMO_ANCHOR when the clock is
 * pinned, else at boot time. Returns null when SEED_ON_BOOT=off. A pinned stack refuses a stored
 * world anchored at another instant (the clock would disagree with every row), naming DEMO_ANCHOR.
 */
export async function bootWorld(
  sql: Sql,
  config: Pick<AppConfig, "seedOnBoot" | "worldSeed">,
  clock: Clock,
): Promise<{ seeded: boolean; anchor: Date } | null> {
  const pinned = clock.anchor();
  let world: { seeded: boolean; anchor: Date } | null = null;
  if (config.seedOnBoot !== "off") {
    world = await seedDatabase(sql, {
      seed: config.worldSeed,
      anchor: pinned ?? new Date(),
      mode: config.seedOnBoot,
    });
  } else if (pinned) {
    const [row] = await sql<{ anchor: string }[]>`select anchor from world_meta where id = 1`;
    if (row) world = { seeded: false, anchor: new Date(row.anchor) };
  }
  if (pinned && world && world.anchor.getTime() !== pinned.getTime()) {
    throw new ConfigError(
      `DEMO_ANCHOR is ${pinned.toISOString()} but the stored world is anchored at ` +
        `${world.anchor.toISOString()}. Set SEED_ON_BOOT=reset to reseed at DEMO_ANCHOR, or unset DEMO_ANCHOR.`,
    );
  }
  return world;
}

export interface StackDeps {
  config: AppConfig;
  sql: Sql;
  llm: { client: Anthropic };
  clock: Clock;
  log: (message: string) => void;
  /** The ERP approved orders are pushed to; defaults to ERP_BASE_URL. */
  erp?: ErpClient;
  /** The published evaluation summary; defaults to evals/published/summary.json. */
  evalSummaryPath?: string;
  /** Receives each background extraction (inbox delivery, review retry). Tests await them. */
  track?: (processing: Promise<void>) => void;
}

/** The API app, with the ask agent, inbox, review, approvals and live routes all on `clock`. */
export function createStackApp(deps: StackDeps) {
  const { config, sql, llm, clock, log } = deps;
  const now = clock.now;
  // The pinned demo reads the seeded port waits so its numbers stay fixed; live reads AIS.
  const congestion = clock.pinned ? ("seed" as const) : ("latest" as const);
  const inbox: InboxDeps = {
    sql,
    extractor: createLlmExtractor(llm, config),
    inboxDir: DEMO_INBOX_DIR,
    log,
    now,
    ...(deps.track ? { track: deps.track } : {}),
  };
  const app = createApp({
    llmMode: config.llmMode,
    pingDb: () => pingDb(sql),
    models: { extractModel: config.extractModel, agentModel: config.agentModel },
    read: createDbSource(sql, now),
    inbox,
    review: inbox,
    ask: { sql, llm, config, log, now, congestion },
    approvals: { sql, erp: deps.erp ?? createErpClient(config.erpBaseUrl), log, now },
    llmCalls: { sql },
    live: { sql, now, congestion },
    clock,
    evalSummary: { path: deps.evalSummaryPath ?? DEFAULT_EVAL_SUMMARY_PATH },
  });
  return { app, inbox };
}
