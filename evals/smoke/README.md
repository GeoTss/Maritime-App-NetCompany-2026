# Live smoke and measurement

`npm run eval:smoke [-- --label <name>]` drives the running API over HTTP (`API_URL`, default
`http://localhost:4000`; no key needed, the API holds it):

1. `/api/health` must report `llmMode: live` (else exit 2: "start the API with LLM_MODE=live"),
   and `extractModel` and `agentModel` must both be `claude-haiku-5-5`. Otherwise the run stops
   with exit 1 before it delivers anything, so it makes no paid call. An API image built before
   `/api/health` reported its models also stops there: rebuild it (`docker compose up -d --build`).
2. Delivers both demo emails, polls each extraction until it leaves `pending` (90 s timeout) and
   times deliver -> extraction (target about 20 s).
3. Checks the two quotes against `DEMO_SCENARIO` (supplier, port, currency, price, barge fee, qty).
4. Asks the demo question and times the round trip (target about 45 s); asserts the release gate
   passed, at least one fact, and a pending `MTMLA-kestrel` recommendation.
5. Approves it and asserts an `erpPoNumber`.
6. Reads `/api/llm-calls` (this run's extractions plus the ask's `llmCallIds`).

Writes `evals/reports/<UTC timestamp>-smoke-<label>/report.json` and `report.md` (step latencies,
per-purpose totals with the model used, every call, totals) and prints the table. On success it
touches `.claude/state/markers/live-smoke` (`MARKERS_DIR` overrides the directory). Exit codes:
0 pass, 1 failed assertion(s) (all listed), 2 API not in live mode.

The demo inbox can be delivered once per world. A second run exits 1 with "inbox already
delivered"; reset with `docker compose up -d --force-recreate api erp` (SEED_ON_BOOT=reset; recreating the
ERP simulator clears its in-memory orders too).

Phase 3 runs Haiku 5.5 only, so the smoke refuses an API configured with another model (step 1).
Model comparisons are `evals/compare/`, under their own budget.

`/api/llm-calls` returns only the newest 200 rows, so run the smoke against a freshly restarted API.
A run costing more than $0.25 (`RUN_CAP_USD`, per run) fails and writes no marker.

Per-phase budget: before the first request it checks `evals/spend-ledger.jsonl` (`assertBudget(0.01)`;
the current phase's cap is in `evals/budget.json`, see `evals/lib/`), and afterwards appends the run's cost from
`/api/llm-calls`, also when the run stopped early after making calls. Any call whose model is not
`claude-haiku-5-5` fails the run.

`run.test.ts` is the free dry test: the same runner against the in-process app in replay mode.
