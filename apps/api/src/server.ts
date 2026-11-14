import { serve } from "@hono/node-server";
import { createSql, pingDb } from "@pharos/db";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";

function main() {
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
  const app = createApp({ llmMode: config.llmMode, pingDb: () => pingDb(sql) });

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

main();
