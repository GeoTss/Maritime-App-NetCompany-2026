/**
 * Records the live demo ask into RECORDINGS_DIR, for the replay test in agent.test.ts. Run on the
 * host (the key stays in .env and is never printed):
 *
 *   LLM_MODE=record LLM_FALLBACKS=off npx tsx --env-file=.env apps/api/src/ask/record-demo-ask.ts
 *
 * Builds the database exactly as the replay test does (prepareAskFixture in its own test database,
 * clock ASK_FIXTURE_NOW) and uses the fixed config below (not AGENT_MODEL / AGENT_EFFORT), so the
 * request bodies match what the test sends. Stops if the run's cost passes MAX_RUN_USD.
 */
import { pathToFileURL } from "node:url";
import { connectTestDb } from "@pharos/db/testing";
import { appendSpend, assertBudget } from "../../../../evals/lib/budget.js";
import { type AgentConfig, runAgent } from "../ai/agent.js";
import { captureLlmCall } from "../ai/call-capture.js";
import { createLlm } from "../ai/llm.js";
import { DEFAULT_RECORDINGS_DIR } from "../config.js";
import { ASK_FIXTURE_NOW, DEMO_QUESTION, prepareAskFixture } from "./demo-fixture.js";

/** The agent config every committed ask recording was made with (Haiku defaults). */
export const ASK_RECORDING_CONFIG: AgentConfig = {
  agentModel: "claude-haiku-5-5",
  agentEffort: "medium",
  llmFallbacks: false,
};

const MAX_RUN_USD = 0.25;

/**
 * The spend to ledger: only calls that reached the model. Record mode reuses an existing
 * recording (mode "replay" in the row, with its recorded usage), which cost nothing this run.
 */
export function ledgerableCostUsd(calls: { mode: string; cost_usd: number }[]): number {
  return calls.filter((c) => c.mode === "record").reduce((sum, c) => sum + c.cost_usd, 0);
}

async function main() {
  if (process.env.LLM_MODE !== "record") {
    throw new Error("Run with LLM_MODE=record (this script only records).");
  }
  if (process.env.LLM_FALLBACKS && process.env.LLM_FALLBACKS !== "off") {
    throw new Error("Run with LLM_FALLBACKS=off: recordings are made without fallbacks.");
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (add it to .env).");

  // Ledgered like every live run: refuse before the first call if the phase budget is not set.
  assertBudget(MAX_RUN_USD);

  const sql = await connectTestDb("ask_record");
  if (!sql) throw new Error("Postgres is unreachable (start it with docker compose up -d db).");
  try {
    await prepareAskFixture(sql);
    const llm = createLlm({
      mode: "record",
      apiKey,
      recordingsDir: DEFAULT_RECORDINGS_DIR,
      onCall: captureLlmCall,
    });
    let res: Awaited<ReturnType<typeof runAgent>> | undefined;
    let failure: unknown;
    try {
      res = await runAgent(
        { sql, llm, config: ASK_RECORDING_CONFIG, now: () => ASK_FIXTURE_NOW },
        DEMO_QUESTION,
      );
    } catch (err) {
      failure = err;
    }

    // The database is fresh, so every llm_calls row is this run's (also when the ask failed).

    const calls = await sql<
      {
        request_key: string;
        model: string;
        mode: string;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_write_tokens: number;
        latency_ms: number;
        cost_usd: number;
        stop_reason: string | null;
      }[]
    >`select request_key, model, mode, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
             latency_ms, cost_usd, stop_reason
      from llm_calls order by id`;
    let total = 0;
    for (const m of calls) {
      total += m.cost_usd;
      console.log(
        [
          `key=${m.request_key.slice(0, 12)}`,
          m.model,
          `mode=${m.mode}`,
          `in=${m.input_tokens}`,
          `out=${m.output_tokens}`,
          `cacheRead=${m.cache_read_tokens}`,
          `cacheWrite=${m.cache_write_tokens}`,
          `stop=${m.stop_reason}`,
          `latencyMs=${Math.round(m.latency_ms)}`,
          `costUsd=${m.cost_usd.toFixed(6)}`,
        ].join(" "),
      );
    }
    console.log(`total costUsd=${total.toFixed(6)} for ${calls.length} calls`);
    const spent = ledgerableCostUsd(calls);
    console.log(`ledgered costUsd=${spent.toFixed(6)} (calls that reached the model)`);
    if (spent > 0) {
      appendSpend({
        at: new Date().toISOString(),
        run: "record-demo-ask",
        label: "ask-recording",
        costUsd: spent,
      });
    }
    if (!res) throw failure;
    console.log(
      `gate=${JSON.stringify(res.gate)} recommendations=${res.recommendationIds.join(",")}`,
    );
    console.log(`answer=${JSON.stringify(res.answer)}`);
    if (spent > MAX_RUN_USD) {
      throw new Error(`Run cost ${spent.toFixed(4)} USD exceeds ${MAX_RUN_USD} USD.`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[record] ${(err as Error).message}`);
    process.exit(1);
  });
}
