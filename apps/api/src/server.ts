import { serve } from "@hono/node-server";
import { createSql, runMigrations } from "@pharos/db";
import { captureLlmCall } from "./ai/call-capture.js";
import { createLlm } from "./ai/llm.js";
import { createClock } from "./clock.js";
import { ConfigError, loadConfig } from "./config.js";
import { failInterruptedExtractions, processDocument } from "./ingest/workflow.js";
import { bootWorld, createStackApp } from "./stack.js";

async function main() {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[api] refusing to start: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  // Pinned (DEMO_ANCHOR), every request reads anchor + 5 min; unpinned, the wall clock.
  const clock = createClock(config.demoAnchor);
  const sql = createSql(config.databaseUrl);
  await runMigrations(sql);
  console.log("[api] migrations applied");
  // The demo world is anchored at DEMO_ANCHOR, or else at the moment the stack boots.
  let world: Awaited<ReturnType<typeof bootWorld>>;
  try {
    world = await bootWorld(sql, config, clock);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[api] refusing to start: ${err.message}`);
      await sql.end({ timeout: 2 });
      process.exit(1);
    }
    throw err;
  }
  if (world) {
    console.log(
      `[api] world ${world.seeded ? "seeded" : "kept"} (SEED_ON_BOOT=${config.seedOnBoot}, seed=${config.worldSeed}, anchor=${world.anchor.toISOString()})`,
    );
  }
  console.log(
    clock.pinned
      ? `[api] clock pinned: now=${clock.now().toISOString()} (DEMO_ANCHOR + 5 min)`
      : "[api] clock: wall time",
  );
  // Every model call goes through this client; calls are recorded (with their document or
  // conversation) by the workflow and the agent from the metrics captured per call.
  const llm = createLlm({
    mode: config.llmMode,
    apiKey: config.anthropicApiKey,
    recordingsDir: config.recordingsDir,
    onCall: captureLlmCall,
  });
  const log = (message: string) => console.warn(message);
  const { app, inbox } = createStackApp({ config, sql, llm, clock, log });

  // An extraction claimed but still pending was cut off mid-way by a crash or restart: mark it
  // failed so it waits in the review queue for a retry, instead of being silently re-run.
  const interrupted = await failInterruptedExtractions(sql);
  if (interrupted > 0) console.log(`[api] marked ${interrupted} interrupted extraction(s) failed`);
  // Extractions stored but never started are processed now (processDocument claims each one).
  const pending = await sql<{ document_id: number }[]>`
    select distinct document_id from extractions
    where status = 'pending' and claimed_at is null order by document_id`;
  void (async () => {
    for (const { document_id } of pending) await processDocument(inbox, document_id);
  })();
  if (pending.length > 0) console.log(`[api] resuming ${pending.length} pending extraction(s)`);

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(
      `[api] listening on :${info.port} (LLM_MODE=${config.llmMode}, ERP ${config.erpBaseUrl})`,
    );
  });

  const shutdown = async () => {
    server.close();
    await sql.end({ timeout: 2 });
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[api] failed to start:", err);
  process.exit(1);
});
