import { serve } from "@hono/node-server";
import { createSql, pingDb, runMigrations, seedDatabase } from "@pharos/db";
import { captureLlmCall } from "./ai/call-capture.js";
import { createLlmExtractor } from "./ai/extract.js";
import { createLlm } from "./ai/llm.js";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createErpClient } from "./executor/erp-client.js";
import { DEMO_INBOX_DIR, type InboxDeps } from "./inbox/routes.js";
import { processDocument } from "./ingest/workflow.js";
import { createDbSource } from "./read/db-source.js";

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

  const sql = createSql(config.databaseUrl);
  await runMigrations(sql);
  console.log("[api] migrations applied");
  if (config.seedOnBoot !== "off") {
    // The demo world is anchored to the moment the stack boots.
    const result = await seedDatabase(sql, {
      seed: config.worldSeed,
      anchor: new Date(),
      mode: config.seedOnBoot,
    });
    console.log(
      `[api] world ${result.seeded ? "seeded" : "kept"} (SEED_ON_BOOT=${config.seedOnBoot}, seed=${config.worldSeed}, anchor=${result.anchor.toISOString()})`,
    );
  }
  // Every model call goes through this client; calls are recorded (with their document or
  // conversation) by the workflow and the agent from the metrics captured per call.
  const llm = createLlm({
    mode: config.llmMode,
    apiKey: config.anthropicApiKey,
    recordingsDir: config.recordingsDir,
    onCall: captureLlmCall,
  });
  const log = (message: string) => console.warn(message);
  const inbox: InboxDeps = {
    sql,
    extractor: createLlmExtractor(llm, config),
    inboxDir: DEMO_INBOX_DIR,
    log,
  };
  const app = createApp({
    llmMode: config.llmMode,
    pingDb: () => pingDb(sql),
    read: createDbSource(sql),
    inbox,
    ask: { sql, llm, config, log },
    approvals: { sql, erp: createErpClient(config.erpBaseUrl), log },
    llmCalls: { sql },
  });

  // Finish extractions a crash or restart interrupted (processDocument skips any no longer pending).
  const pending = await sql<{ document_id: number }[]>`
    select distinct document_id from extractions where status = 'pending' order by document_id`;
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
