# Developing Pharos

How to set up, run, configure, test and measure Pharos on your own machine. For what the pieces are
and why, read [`ARCHITECTURE.md`](ARCHITECTURE.md) first.

- [Prerequisites](#prerequisites)
- [First run](#first-run)
- [Ways to run it](#ways-to-run-it)
- [Configuration reference](#configuration-reference)
- [Tests and checks](#tests-and-checks)
- [The demo story](#the-demo-story-end-to-end)
- [Evaluation](#evaluation)
- [Database and fixtures](#database-and-fixtures)
- [Conventions](#conventions)
- [Troubleshooting](#troubleshooting)

## Prerequisites

| Tool | Version | For |
| --- | --- | --- |
| Docker with Compose v2 | recent | The stack, and Postgres for the database tests |
| Node | 22.12 or later | Scripts, tests, the dev servers |
| git | a full clone | One guard test reads an earlier commit, so a shallow clone or a zip fails `npm run verify` |

No API key is needed for the recorded demo, the tests or a free evaluation run.

## First run

```bash
npm ci
```

```bash
docker compose up -d --build
```

Then open <http://localhost:5173>. The first build installs the dependencies and builds the
console; later starts reuse the image. Check that the API is up and in which mode:

```bash
curl http://localhost:4000/api/health
```

```json
{ "status": "ok", "llmMode": "replay", "db": "up", "extractModel": "claude-haiku-5-5", "agentModel": "claude-haiku-5-5" }
```

## Ways to run it

Every mode (the recorded demo, the free live rehearsal, fully live, the demo world with a live
model, record mode, mixed sources) and every developer setup (the console with hot reload, the API
from source) is a step-by-step section in [`RUNNING.md`](RUNNING.md). What matters while coding:

- All Node services share one image, and the console is built into it. `npm run demo:reset`
  recreates the containers but does not rebuild, so after a code change run
  `docker compose build && npm run demo:reset`.
- The API migrates the database and reseeds the synthetic world on every boot in Compose
  (`SEED_ON_BOOT=reset`), so recreating the `api` container gives you a clean world.
- Four variables decide the mode. Set them with the scripts, not by hand:

| Switch | Values | Default in Compose | Effect |
| --- | --- | --- | --- |
| `LLM_MODE` | `live`, `record`, `replay` | `replay` | `replay` serves recorded model replies and fails on a miss; `record` serves a recording when there is one and otherwise calls the model and saves the reply; `live` always calls the model |
| `AIS_MODE` | `live`, `replay`, `off` | `replay` | Live AISStream, or the recorded capture on a loop |
| `WEATHER_MODE` | `live`, `recorded` | `recorded` | Live Open-Meteo, or the stored snapshot |
| `DEMO_ANCHOR` | an ISO instant, or empty | `2026-11-14T08:00:00Z` | Set: the world is seeded at that instant and the clock is frozen at anchor + 5 minutes. Empty: wall clock |

A recording is keyed by the sha256 of the whole request. Change a prompt, a tool description, the
order of the tools or anything a tool returns, and the old recordings no longer match. Re-record
in [record mode](RUNNING.md#5-record-mode-refreshing-the-recorded-replies), under the protocol in
the `eval-bench` and `demo-e2e` skills (`.claude/skills/`).

## Configuration reference

Configuration comes from the environment through a validated loader. A service that is
misconfigured refuses to start and names the variable, never its value. Start from `.env.example`.

**Keys.** Add them to `.env` yourself. Never commit, print or log `.env`.

| Variable | Used by | Required when |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | api | `LLM_MODE` is `live` or `record` |
| `AISSTREAM_API_KEY` | worker | `AIS_MODE=live`. Without it the worker logs one line and replays the capture |

Open-Meteo needs no key.

**API** (`apps/api/src/config.ts`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | none (required) | Postgres URL |
| `LLM_MODE` | `live` (`replay` in Compose) | See [Ways to run it](#ways-to-run-it) |
| `API_PORT` | `4000` | Port the API listens on |
| `SEED_ON_BOOT` | `if-empty` (`reset` in Compose) | `reset` wipes and reseeds; `if-empty` seeds an empty database; `off` does nothing |
| `WORLD_SEED` | `20261114` | Seed of the synthetic world |
| `DEMO_ANCHOR` | unset (pinned in Compose) | See [Ways to run it](#ways-to-run-it) |
| `EXTRACT_MODEL`, `AGENT_MODEL` | `claude-haiku-5-5` | Model per prompt. A model must have an entry in `apps/api/src/ai/pricing.ts` |
| `EXTRACT_EFFORT`, `AGENT_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh` or `max` |
| `LLM_FALLBACKS` | `off` | Server-side refusal fallbacks, `on` or `off` |
| `RECORDINGS_DIR` | `fixtures/llm-recordings` | Where model recordings are read and written |
| `ERP_BASE_URL` | `http://localhost:4100` | Where approved purchase and security orders are pushed |
| `DEMO_CONTROLS` | `off` (`off` in Compose; `npm run demo:reset` sets `on`) | `on` lets the Scenario panel edit the world. Edits also need the pinned clock and recorded weather |
| `DEMO_STORM` | `off` (`on` in Compose) | A scenario reset lays the labelled synthetic storm over the recorded weather, as the worker does. Keep it equal to the worker's |

**Worker** (`apps/worker/src/config.ts`; more in [`apps/worker/README.md`](../apps/worker/README.md))

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | none (required) | Postgres URL |
| `AIS_MODE` | `replay` | See [Ways to run it](#ways-to-run-it) |
| `WEATHER_MODE` | `recorded` | See [Ways to run it](#ways-to-run-it) |
| `DEMO_HAZARDS` | `off` (`on` in Compose) | Load the labelled synthetic hazard with live AIS. Replay always loads it |
| `DEMO_STORM` | `off` (`on` in Compose) | Lay the labelled synthetic storm west of Crete over the recorded weather (`fixtures/recorded/synthetic-storm.json`). Ignored with live weather |
| `DEMO_ANCHOR` | unset (pinned in Compose) | Pinned: load the recorded sources once at that instant |

**Other services and tools**

| Variable | Default | Used by |
| --- | --- | --- |
| `ERP_PORT` | `4100` | ERP simulator |
| `API_PROXY_TARGET` | `http://localhost:4000` | The console's `/api` proxy (dev server and preview) |
| `TEST_DATABASE_URL` | `postgres://pharos:pharos@localhost:5432/pharos_test` | Database tests |
| `STORY_MODE` | recorded | `live` runs the Playwright story against a live stack |
| `STORY_SCREENSHOTS` | `test-results/` | `docs` rewrites `docs/screenshots/phase-6/` |
| `API_URL` | `http://localhost:4000` | `npm run eval:smoke` |

Leave `DEMO_ANCHOR` out of `.env`. A blank `DEMO_ANCHOR=` line unpins the recorded demo and every
replay misses.

## Tests and checks

```bash
npm run verify
```

This runs, in order, what you can also run one at a time:

| Command | Checks |
| --- | --- |
| `npm run typecheck` | `tsc` over the Node workspaces and the console |
| `npm run lint` | Biome (`npm run format` fixes what it can) |
| `npm run check:purity` | `packages/domain` imports no network, model SDK, environment, clock or randomness |
| `npm run test` | Vitest: a `node` project for packages, API, worker, ERP, scripts and evals, and a `web` project (happy-dom) for the console |

Notes:

- **Database tests** need Postgres on `localhost:5432` (`docker compose up -d db`) and are skipped
  without it. Each test file gets its own database, `pharos_test_<name>`, so files run in parallel.
- **One test run at a time.** Two runs at once (say `npm run verify` in the background while you
  run a file, or another session's run) share those databases and fail with missing rows or odd
  counts. Rerun a failing database test alone before you believe it.
- **Tests never call the model.** They run in replay or with a scripted client.
- **Tests sit beside the code** as `*.test.ts`. Domain code is written test-first.
- Run one file with `npx vitest run path/to/file.test.ts`.

## The demo story, end to end

Two stories drive the real console: `e2e/demo.spec.ts`, the six steps, and
`e2e/security.spec.ts`, the optional "Suez or the Cape" act (security quotes, Atlantic Meridian's
route, the security order and the instruction that waits for it). There is no `webServer` block:
bring the stack up first.

```bash
npx playwright install chromium
```

```bash
npm run demo:reset && npx playwright test
```

Both run on recorded replies, free, and must finish with no replay miss. The recorded replies
depend on the same actions in the same order, so reset before each run. Run one story with
`npx playwright test e2e/security.spec.ts`.

| Variant | Command |
| --- | --- |
| Live story (paid, about $0.01 to $0.03) | `npm run demo:live && STORY_MODE=live npx playwright test` |
| Refresh the committed screenshots | `npm run demo:reset && STORY_SCREENSHOTS=docs npx playwright test` |

## Evaluation

Extraction and question answering are measured against golden sets with programmatic graders. The
method and the results are in [`APPROACH.md`](APPROACH.md); the runner details are in
[`evals/extraction/README.md`](../evals/extraction/README.md) and
[`evals/qa/README.md`](../evals/qa/README.md).

Every way to run a suite:

| Run | Command (add `--suite qa` or `--suite extraction`) | Cost | What it tells you |
| --- | --- | --- | --- |
| Oracle | `npm run eval -- --suite qa --split dev --oracle` | free | The truth fed through the graders scores about 100 %: the graders work |
| Empty | `npm run eval -- --suite qa --split dev --empty` | free | An empty result scores about 0 %: the graders are not too lenient |
| Replay | `npm run eval -- --suite qa --split dev --mode replay` | free | The current code on recorded model replies; a request with no recording is listed as a `replay_miss` error, not a wrong answer |
| Live | `npm run eval -- --suite qa --split dev --mode live` | paid, ledgered | A real measurement. Only live runs are published |
| Record | `npm run eval -- --suite qa --split dev --mode record` | paid for misses only | Like replay, but a miss calls the model and saves the reply |

Run the oracle and the empty runs before any paid pass. `--limit n` and `--offset n` run a chunk;
`--label x` names the report in `evals/reports/`.

**State of the recordings (20 Nov 2026).** The dev replays are partly stale, so a replay run is not
yet a clean check:

| Suite | Replay result now | Why |
| --- | --- | --- |
| Extraction, dev | 92 of 114 cases are a `replay_miss`; the 22 re-recorded on 20 Nov replay | The other recordings are for an earlier extraction prompt; the `extract-quote/v4` dev pass of 19 Nov ran live, without recording, and the 20 Nov re-record pass was stopped after 22 cases |
| Q&A, dev | 7 of 35 are `replay_miss` (`compliance-01`, `-02`, `route-speed-01`, `-02`, `-03`, `-09`, `-10`); the other 28 run, every metric at 100 % | Those plans changed with the provisions rule of 20 Nov; only the demo story's replies were re-recorded |

The oracle and empty runs are unaffected. A record pass of each suite fixes the replays (paid,
under the `eval-bench` protocol).

Rules that the tooling enforces:

- **Ground truth is never written by a model and never edited to make a score pass.** A hook blocks
  edits to the truth files in `evals/golden/`.
- **Paid runs are budgeted.** `evals/budget.json` holds the phase cap and
  `evals/spend-ledger.jsonl` every live run; a runner refuses to start over the cap. See
  [`evals/lib/README.md`](../evals/lib/README.md).
- **The held-out split has run and is closed.** `evals/heldout-passes.jsonl` lists every held-out
  case that ran, and the runner refuses a listed case.
- **Reported accuracy comes from live runs only.** `npm run eval:publish` refuses replay, oracle
  and empty reports.
- **A prompt change needs a live smoke run** (`npm run eval:smoke`) and new recordings, under the
  `eval-bench` protocol.

## Database and fixtures

| Command | Does |
| --- | --- |
| `npm run db:generate` | Generates a migration from `packages/db/src/schema.ts` |
| `npm run db:migrate` | Applies migrations |
| `npm run db:seed` | Seeds the synthetic world |
| `npm run routes:network` | Rebuilds the sea-route network from the Eurostat data |
| `npm run record:ais` | Records a new AIS capture (needs `AISSTREAM_API_KEY`) |
| `npm run record:weather` | Records a new weather snapshot (`-- --region added` fetches only the points added for Track 3, round Africa and through the Red Sea and Arabian Sea, and merges them in) |
| `npm run smoke:ais`, `npm run smoke:weather` | Check that the live feeds answer |
| `npm run map:basemap` | Rebuilds the bundled Natural Earth basemap |
| `npm run smoke:pdf` | PDF text extraction smoke check |

The API applies migrations at boot, so you rarely run `db:migrate` by hand.

Refreshing the recorded AIS capture or weather snapshot moves the world the evaluation truths were
computed on, and every route replay. Do it only with the `maritime-data` skill's procedure, and
expect to regenerate truths and re-record replies.

## Conventions

- TypeScript 6, ESM, `moduleResolution: bundler`. Relative imports use `.js` suffixes.
- Packages export `./src/index.ts`; there is no build step for services.
- Zod at every boundary: HTTP, model output, tool input, external payloads, environment.
- All maths lives in `packages/domain`. A tool or a view loads data and calls it.
- The console computes no business number; it shows what the API returns.
- Work on `build/prototype`; commit locally; do not push unless asked.

Adding an agent tool touches eleven places, in a fixed order. The checklist is in
[`CLAUDE.md`](../CLAUDE.md#adding-an-agent-tool-checklist). The console's library rules are there
too, under "UI rules".

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `[api] refusing to start: LLM_MODE=live needs ANTHROPIC_API_KEY` | Live or record mode without the key | Add the key to `.env`, or run `npm run demo:reset` for the recorded demo |
| "This question has no recorded reply" on a scripted question | An extra or failed "Plan route", or steps out of order, changed the request | `npm run demo:reset` and start again from step 1 |
| The same message on any other question | Replay mode has only the three scripted questions | Ask a scripted question, or `npm run demo:live` |
| `replay_miss` in tests after a code change | A prompt, tool description or tool output changed | Re-record under the `eval-bench` protocol |
| The AIS badge reads "recorded" in live mode | `AISSTREAM_API_KEY` is missing, or the feed is down | Add the key, check with `npm run smoke:ais -- --seconds 20` |
| A code change does not show in the console | The containers run the image built earlier | `docker compose up -d --build` |
| `npm run dev:web` fails because port 5173 is in use | The `web` container holds the port | `docker compose stop web`, or run the dev server on 5174 |
| The Scenario panel shows the world but refuses edits | `DEMO_CONTROLS` is off (a plain `docker compose up`), the clock is not pinned, or the weather is live | `npm run demo:reset` |
| "No recorded reply" after a Scenario edit | The recorded replies cover the unedited demo only | Reset from the panel, or ask with a live model: `LLM_MODE=live npm run demo:reset` (paid) |
| An open route plan says it was made before an edit | The world changed after it was planned | Plan again |
| Database tests are skipped | Postgres is not on `localhost:5432` | `docker compose up -d db` |
| `npm run verify` fails on a guard test in a fresh copy | Shallow clone or zip: the test reads an earlier commit | Use a full `git clone` |
| A container is stuck or the state is odd | Varies | `npm run demo:reset` recreates api, erp, worker and web, reseeds and waits |
