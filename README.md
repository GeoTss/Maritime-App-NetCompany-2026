# Pharos — Smart Maritime Operations Assistant

Pharos is a GenAI assistant for the bunker-to-berth desk. It reads supplier quote emails into
structured quotes, answers plain-language questions about the fleet with the facts behind every
number, optimises route and speed against weather, and drafts the purchase order and voyage
instruction for a person to approve.

- The model chooses tools and explains. **All maths is deterministic code** in `packages/domain`.
- Every number shown comes from a cited tool fact; an answer with an unsourced number is withheld.
- The model only proposes. Orders and voyages change only after a human approves.
- **Nothing is ever sent to an external party.** Drafted messages show "draft, not sent"; the ERP is a local simulator.
- Email and document text is treated as untrusted data, never as instructions.

Ports and sea routes are real (UN/LOCODEs, Eurostat maritime network). Vessels, suppliers, prices and quotes are synthetic.

## Quick start (no keys)

Needs Docker and Node 22.12 or later.

```bash
docker compose up --build
```

Open the console at http://localhost:5173. The API is on :4000, the ERP simulator on :4100, Postgres on :5432.

With no `.env`, the stack comes up as the **recorded demo**: recorded model replies, recorded AIS and
weather, the clock pinned to 14 Nov 2026 08:00 UTC. The 397 recorded replies in `fixtures/llm-recordings/`
cover the three scripted demo questions only (see `docs/DEMO_SCRIPT.md`); any other question
shows a "no recorded reply" message.

## Run the demo story

The six-step story runs through the real console with Playwright. With the stack up:

```bash
npm ci
npx playwright install chromium
npm run demo:reset && npx playwright test
```

This is the recorded story: free, about 15 seconds. `npm run demo:reset` recreates the api, erp, worker and
web containers pinned, reseeded and on recorded sources, and waits until they are ready.

## Go live

Put both keys in `.env` (copy `.env.example`; never commit it):

- `ANTHROPIC_API_KEY`: the model (Claude Haiku 5.5).
- `AISSTREAM_API_KEY`: free, from aisstream.io, for live ship positions. Open-Meteo weather needs no key.

```bash
npm run demo:live
```

It waits until the live model, the unpinned clock, live AIS and live weather are all confirmed, and names
the missing variable (never its value) if one is absent. In live mode every question (about $0.001) and
every delivered email (about $0.0007) is a paid model call. Go back to the recorded demo with:

```bash
npm run demo:reset
```

The live story is `npm run demo:live && STORY_MODE=live npx playwright test` (about $0.01).

## Evaluation

Extraction and question answering are measured against golden sets with programmatic graders. The
held-out split ran once, live. The approach, the headline numbers and the stated limits are in
[`docs/APPROACH.md`](docs/APPROACH.md); the same scorecards are on the console's Evaluation page.
The log of earlier passes is `docs/EVAL_LOG.md`.

## Verify

```bash
npm run verify
```

Typecheck, lint, domain purity and tests. It needs a full git clone (one guard test reads an earlier
commit from history, so a shallow clone or a zip fails). Database tests need the `db` container
(Postgres on localhost:5432) and are skipped without it.

## Layout

| Path | What |
| --- | --- |
| `packages/shared` | Zod contracts shared by every service |
| `packages/domain` | Pure maths: routing, speed optimiser, consumption, bunker planner, emissions, congestion |
| `packages/db` | Drizzle schema, migrations, synthetic world seed |
| `packages/integrations`, `apps/worker`, `services/erp-sim` | AIS, weather, sea routes, ERP simulator (live and recorded) |
| `apps/api` | Hono API: ingestion, ops agent and tools, release gate, approvals |
| `apps/web` | React ops console |
| `evals/`, `fixtures/` | Golden sets, graders, runners, reports; recorded AIS, weather and model replies |
| `e2e/` | The six-step demo story |

## More

- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md): preflight, the six steps, fallbacks.
- [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md): the approved design.
- [`docs/APPROACH.md`](docs/APPROACH.md): evaluation and results.
- [`CLAUDE.md`](CLAUDE.md): rules and commands for the build harness.
