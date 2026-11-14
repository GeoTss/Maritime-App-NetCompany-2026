import { serve } from "@hono/node-server";
import { createSql, pingDb, runMigrations, seedDatabase } from "@pharos/db";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createFixtureSource } from "./read/fixtures.js";

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
  const app = createApp({
    llmMode: config.llmMode,
    pingDb: () => pingDb(sql),
    read: createFixtureSource(),
  });

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[api] listening on :${info.port} (LLM_MODE=${config.llmMode})`);
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
