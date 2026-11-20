# Developing Pharos

How to set up, run, configure, test and measure Pharos on your own machine. For what the pieces are
and why, read [`ARCHITECTURE.md`](ARCHITECTURE.md) first.

- [Prerequisites](#prerequisites)
- [First run](#first-run)
- [Ways to run it](#ways-to-run-it)
- [Modes](#modes)
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

No API key is needed for the recorded demo, the tests or a replay evaluation.

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

### Everything in Docker (the default)

`docker compose up -d --build` starts `db`, `erp`, `api`, `worker` and `web`. The API migrates the
database and reseeds the synthetic world on every boot (`SEED_ON_BOOT=reset`), so restarting the
`api` container gives you a clean world.

All Node services share one image, and the console is built into that image. After you change
code, rebuild:

```bash
docker compose up -d --build
```

`npm run demo:reset` recreates the containers but does not rebuild the image.

### The console with hot reload

Keep the backend in Docker and run the console from source. The dev server uses the same port as
the `web` container, so stop that one first:

```bash
docker compose stop web
```

```bash
npm run dev:web
```

Vite serves <http://localhost:5173> and proxies `/api` to `http://localhost:4000`. Set
`API_PROXY_TARGET` to point it somewhere else.

To keep the built console running beside it, start the dev server on another port instead:

```bash
npm run dev -w @pharos/web -- --port 5174 --strictPort
```

### The API from source

Run Postgres and the ERP simulator in Docker, stop the `api` container to free port 4000, and
start the API with `tsx watch`:

```bash
docker compose up -d db erp
```

```bash
docker compose stop api worker
```

```bash
DATABASE_URL=postgres://pharos:pharos@localhost:5432/pharos LLM_MODE=replay DEMO_ANCHOR=2026-11-14T08:00:00Z npm run dev:api
```

`npm run dev:api` reads its configuration from the process environment; it does not load `.env`
for you. The three variables above are the minimum for the recorded demo:

- `DATABASE_URL` is required.
- `LLM_MODE` defaults to `live` outside Compose, and `live` refuses to start without
  `ANTHROPIC_API_KEY`.
- `DEMO_ANCHOR` pins the clock. Without it the recorded model replies do not match.

Outside Compose `SEED_ON_BOOT` defaults to `if-empty`, so the API keeps a world that is already
there. Pass `SEED_ON_BOOT=reset` to start clean. `npm run dev:erp` runs the ERP simulator from
source in the same way.

## Modes

Three independent switches decide where data comes from. The recorded demo is all three on their
recorded side with the clock pinned; `npm run demo:live` flips all of them.

| Switch | Values | Default in Compose | Effect |
| --- | --- | --- | --- |
| `LLM_MODE` | `live`, `record`, `replay` | `replay` | `replay` serves recorded model replies and fails on a miss; `record` serves a recording when there is one and otherwise calls the model and saves the reply; `live` always calls the model |
| `AIS_MODE` | `live`, `replay`, `off` | `replay` | Live AISStream, or the recorded capture on a loop |
| `WEATHER_MODE` | `live`, `recorded` | `recorded` | Live Open-Meteo, or the stored snapshot |
| `DEMO_ANCHOR` | an ISO instant, or empty | `2026-11-14T08:00:00Z` | Set: the world is seeded at that instant and the clock is frozen at anchor + 5 minutes. Empty: wall clock |

Use the two scripts instead of setting these by hand:

| Command | Result |
| --- | --- |
| `npm run demo:reset` | Recorded model, recorded AIS and weather, pinned clock, reseeded, the synthetic storm laid on, and the Scenario panel's edits allowed. Free |
| `npm run demo:live` | Live model, live AIS, live weather, wall clock. Needs both keys; paid |
| `LLM_MODE=replay npm run demo:live` | Live AIS and weather with recorded model replies: a free rehearsal of the live sources |
| `LLM_MODE=live npm run demo:reset` | The pinned demo with a live model, to ask about a world edited in the Scenario panel. Needs `ANTHROPIC_API_KEY`; paid |

A plain `docker compose up` comes up as the recorded demo too, but with `DEMO_CONTROLS=off`: the
Scenario panel shows the world and refuses edits until you run `npm run demo:reset`.

A recording is keyed by the sha256 of the whole request. Change a prompt, a tool description, the
order of the tools or anything a tool returns, and the old recordings no longer match. Re-record
under the protocol in the `eval-bench` and `demo-e2e` skills (`.claude/skills/`).

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
| `LLM_MODE` | `live` (`replay` in Compose) | See [Modes](#modes) |
| `API_PORT` | `4000` | Port the API listens on |
| `SEED_ON_BOOT` | `if-empty` (`reset` in Compose) | `reset` wipes and reseeds; `if-empty` seeds an empty database; `off` does nothing |
| `WORLD_SEED` | `20261114` | Seed of the synthetic world |
| `DEMO_ANCHOR` | unset (pinned in Compose) | See [Modes](#modes) |
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
| `AIS_MODE` | `replay` | See [Modes](#modes) |
| `WEATHER_MODE` | `recorded` | See [Modes](#modes) |
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
| Live story (paid, about $0.01) | `npm run demo:live && STORY_MODE=live npx playwright test` |
| Refresh the committed screenshots | `npm run demo:reset && STORY_SCREENSHOTS=docs npx playwright test` |

## Evaluation

Extraction and question answering are measured against golden sets with programmatic graders. The
method and the results are in [`APPROACH.md`](APPROACH.md); the runner details are in
[`evals/extraction/README.md`](../evals/extraction/README.md) and
[`evals/qa/README.md`](../evals/qa/README.md).

Free runs, no key:

```bash
npm run eval -- --suite extraction --split dev --mode replay
```

```bash
npm run eval -- --suite qa --split dev --mode replay
```

```bash
npm run eval -- --suite extraction --split dev --oracle
```

`--oracle` feeds the truth through the graders (about 100 %) and `--empty` an empty result (about
0 %). Run both before any paid pass: they prove the graders work.

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
