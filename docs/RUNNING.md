# Running Pharos

A step-by-step guide to every way of running Pharos: the free recorded demo, the live stack, the
modes in between, and the developer setups. Each section says what the mode is for, what it
needs, the exact commands, how to check you are in it, and how to get out of it.

If you only want to see the product, do [the recorded demo](#1-the-recorded-demo-free-no-keys).
It takes one command and needs no key.

- [What a mode is](#what-a-mode-is)
- [Before you start](#before-you-start)
- [Choose a mode](#choose-a-mode)
- [1. The recorded demo](#1-the-recorded-demo-free-no-keys)
- [2. Rehearse the live sources for free](#2-rehearse-the-live-sources-for-free)
- [3. Fully live](#3-fully-live)
- [4. The pinned demo with a live model](#4-the-pinned-demo-with-a-live-model)
- [5. Record mode: refreshing the recorded replies](#5-record-mode-refreshing-the-recorded-replies)
- [6. Mixing live and recorded sources](#6-mixing-live-and-recorded-sources)
- [7. Developer setups](#7-developer-setups)
- [Running the checks](#running-the-checks)
- [How to tell which mode you are in](#how-to-tell-which-mode-you-are-in)
- [Stopping and cleaning up](#stopping-and-cleaning-up)
- [Common problems](#common-problems)

## What a mode is

Pharos reads from three outside sources, and each one can be live or recorded:

| Source | Live | Recorded |
| --- | --- | --- |
| The model (Claude Haiku 5.5) | The Anthropic API, paid per call | Replies recorded earlier, in `fixtures/llm-recordings/` |
| Ship positions (AIS) | The AISStream feed | A 10-minute capture from 15 Nov 2026 |
| Weather | The Open-Meteo forecast | A forecast snapshot from 15 Nov 2026 |

A fourth switch is the **clock**. On the recorded demo it is **pinned**: the world is seeded at
14 Nov 2026 08:00 UTC and every request sees 08:05 UTC. A recorded model reply is found by the
exact bytes of the request, and the request contains times, so recorded replies only match on the
pinned clock. On the live stack the clock is the wall clock.

A mode is one combination of these four. Two scripts set them for you, and they are the only way
you should need to switch:

- `npm run demo:reset` gives the pinned clock with recorded AIS and weather. It uses the recorded
  model unless you say otherwise.
- `npm run demo:live` gives the wall clock with live AIS and weather. It uses the live model unless
  you say otherwise.

Both recreate the `api`, `erp`, `worker` and `web` containers, reseed the synthetic world, and wait
until every check passes (up to 3 minutes). If a check does not pass, they say which one.

## Before you start

**You need**

| Tool | Version | Needed for |
| --- | --- | --- |
| Docker with Compose v2 | recent | Everything: the stack runs in containers |
| Node | 22.12 or later | The mode scripts (`npm run demo:*`), tests and dev servers. Not needed to watch the default demo |
| git | a full clone | One test reads an earlier commit, so a zip or a shallow clone fails `npm run verify` |

Ports 5173 (console), 4000 (API), 4100 (ERP simulator) and 5432 (Postgres) must be free.

**Once, after cloning**

```bash
npm ci
```

If `npm ci` fails with permission errors on `~/.npm`, use a cache inside the repository (it is
gitignored):

```bash
npm_config_cache=$PWD/.npm-cache npm ci
```

Build the images while you have a good network. The first build takes a few minutes; later starts
reuse the images.

```bash
docker compose build
```

**Keys (only for live modes)**

```bash
cp .env.example .env
```

Then add your keys to `.env`. Never commit it, and never paste a key into a command line or a log.

| Variable | Where to get it | Needed by |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Modes 3, 4 and 5 (a live or recording model) |
| `AISSTREAM_API_KEY` | aisstream.io (free) | Modes 2 and 3 (live ship positions) |

Open-Meteo needs no key. Leave `LLM_MODE=replay` in `.env` as it comes, and do not add a
`DEMO_ANCHOR=` line: a blank one unpins the clock, and every recorded reply then misses. Docker
Compose reads `.env` by itself; a variable you set on the command line wins over it.

## Choose a mode

| # | Mode | Use it to | Command | Keys | Cost |
| --- | --- | --- | --- | --- | --- |
| 1 | Recorded demo | See or present the product; run the demo stories | `npm run demo:reset` | none | free |
| 2 | Live rehearsal | Check the live feeds before a live demo | `LLM_MODE=replay npm run demo:live` | AIS | free |
| 3 | Fully live | Ask anything, deliver any email, see today's sea | `npm run demo:live` | both | about $0.001 a question |
| 4 | Pinned demo, live model | Ask your own questions about the demo world, also after a scenario edit | `LLM_MODE=live npm run demo:reset` | Anthropic | about $0.001 a question |
| 5 | Record mode | Refresh the recorded replies after a prompt or tool change | `LLM_MODE=record npm run demo:reset` | Anthropic | paid only for what was not recorded |
| 6 | Mixed sources | Isolate one live source | e.g. `AIS_MODE=replay npm run demo:live` | depends | depends |
| 7 | Developer setups | Change code with hot reload | see [section 7](#7-developer-setups) | none | free |

`npm run demo:reset` takes you back to mode 1 from any of them.

## 1. The recorded demo (free, no keys)

The default. Everything is recorded and the clock is pinned, so the demo runs offline and is the
same every time.

**Start it**

```bash
docker compose up -d --build
```

```bash
npm run demo:reset
```

The first command builds and starts the five containers. On its own it already gives you the
recorded demo, but with the Scenario panel read-only. The second recreates the containers on the
pinned demo with the Scenario panel's edits allowed, and waits until the stack is ready:

```text
demo:reset (LLM_MODE=replay, anchor 2026-11-14T08:00:00Z): recreating api, erp, worker, web
...
demo stack ready: web http://localhost:5173, api http://localhost:4000
```

It usually takes about 15 seconds.

**Open it** at <http://localhost:5173>.

**Check you are in it**

- The top bar shows **AIS recorded**, **Weather recorded** and **sim 14 Nov 08:05Z pinned**.
- The assistant panel shows **model: recorded**.
- The API agrees:

```bash
curl -s localhost:4000/api/health
```

```json
{"status":"ok","llmMode":"replay","db":"up","extractModel":"claude-haiku-5-5","agentModel":"claude-haiku-5-5"}
```

**What you can do**

- Everything on the map, Inbox, Approvals and Evaluation screens.
- Deliver the six demo emails ("Deliver next email").
- Ask the three scripted questions, in order (they are the assistant's suggested questions). Any
  other question shows "This question has no recorded reply".
- Plan routes, propose and approve orders, and use the Scenario panel to change the world.

The recorded replies depend on the same actions in the same order. If a scripted question shows
"no recorded reply" (after an extra "Plan route", or steps out of order), run `npm run demo:reset`
and start again. The full walk-through is [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md).

**Reset it** before every demo, after Scenario edits, or whenever the state looks odd:

```bash
npm run demo:reset
```

It empties the chats, approvals and inbox, and reseeds the same world. It does not rebuild the
images: after changing code, run `docker compose build` first.

## 2. Rehearse the live sources for free

Live AIS and live weather on the wall clock, with the recorded model. Use it the day before a live
demo to check the feeds without paying for model calls.

**Needs** `AISSTREAM_API_KEY` in `.env`.

```bash
LLM_MODE=replay npm run demo:live
```

The script waits until the API is up, the clock is unpinned, both sources report `live`, the AIS
socket is up, and at least one real ship outside the fleet has arrived. Then it prints, for
example:

```text
demo:live (LLM_MODE=replay, AIS_MODE=live, WEATHER_MODE=live, wall clock): recreating api, erp, worker, web
live stack ready in 19 s: llmMode replay, ais live (live; 0 congestion rows), weather live (snapshot 1 from open-meteo), 6 named non-fleet ships; web http://localhost:5173, api http://localhost:4000
```

The ship count grows over the first minutes as the feed delivers more ships.

**Check you are in it:** both badges read **live**, the clock shows today's time without "pinned",
and the assistant panel still reads **model: recorded**.

**What works:** the map with live traffic and weather, route planning, and the Inbox: the six demo
emails are read from their recordings, which do not depend on the clock. The assistant does not:
its recorded replies were made on the pinned clock, so questions show "no recorded reply".

You can also check each feed on its own, without the stack:

```bash
npm run smoke:ais -- --seconds 20
```

```bash
npm run smoke:weather
```

**Leave it** with `npm run demo:reset`.

## 3. Fully live

The live model, live AIS, live weather and the wall clock. Any question works, any `.eml` you
upload is read, and the map shows ships at sea now.

**Needs** both keys in `.env`.

**Costs** about $0.001 per question and $0.0007 per delivered email (Claude Haiku 5.5). The whole
demo story costs about $0.01 to $0.03. Every call is listed at `GET /api/llm-calls` with its cost.

```bash
npm run demo:live
```

It waits for the same checks as mode 2, plus the live model, and then prints a line starting
`live stack ready in … s: llmMode live`.

**Check you are in it:** both badges read **live**, the clock is not pinned, and the assistant panel
reads **model: live**.

**What is different from the recorded demo**

- The world is seeded at the moment the API starts, so voyage times, ETAs and fleet positions move
  with the real clock.
- Real ships come and go, so the public ship and the route options differ from run to run.
- The Scenario panel is read-only: edits need the pinned clock and recorded weather.

**If it does not come up**, the script stops after 3 minutes with a line starting
`demo:live FAILED:` that lists the checks still missing:

| It says | Do this |
| --- | --- |
| `api /api/health is not ok (… ANTHROPIC_API_KEY is set)` | Add `ANTHROPIC_API_KEY` to `.env`. In live mode the API refuses to start without it |
| `api /api/sources ais is "recorded", wanted "live" (check AISSTREAM_API_KEY)` | Add `AISSTREAM_API_KEY`, then check the feed: `npm run smoke:ais -- --seconds 20` |
| `ais detail says socket down` | The key is wrong or AISStream is down; check with the smoke command above |
| `api /api/sources weather is … (Open-Meteo may be down)` | Check with `npm run smoke:weather`; try again later |
| `api /api/traffic has no named ship outside the fleet` | AIS connected but delivered no named ship yet; run the command again |
| `api /api/clock is pinned` | Something set `DEMO_ANCHOR`; remove it from `.env` and your shell |

**Stop spending** at any time with `npm run demo:reset`.

## 4. The pinned demo with a live model

The recorded demo world (pinned clock, recorded AIS and weather, Scenario edits allowed) with the
live model. Use it to ask your own questions about the demo world, and to ask about a world you
changed in the Scenario panel: the recorded replies only cover the unedited demo.

**Needs** `ANTHROPIC_API_KEY`. **Costs** the same per call as mode 3.

```bash
LLM_MODE=live npm run demo:reset
```

**Check:** badges **recorded**, clock **pinned**, assistant **model: live**, and
`curl -s localhost:4000/api/health` shows `"llmMode":"live"`.

Replies in this mode are not saved. Go back with `npm run demo:reset`.

## 5. Record mode: refreshing the recorded replies

Recorded replies are found by the exact bytes of each request. Changing a prompt, a tool's
description, the order of the tools, or anything a tool returns changes those bytes, and the old
recordings stop matching. Tests and the recorded demo then report a `replay_miss`. Record mode
fixes that.

Record mode is replay-first: a request that already has a recording is served from it, free, and is
never overwritten. Only a request with no recording calls the model, and its reply is saved to
`fixtures/llm-recordings/`.

**Needs** `ANTHROPIC_API_KEY`. **Costs** only the calls that were missing.

Re-record the demo stories:

```bash
LLM_MODE=record npm run demo:reset && npx playwright test
```

Then prove the new recordings work, twice, on the recorded demo:

```bash
npm run demo:reset && npx playwright test
```

Re-record an evaluation set's missing replies:

```bash
npm run eval -- --suite qa --split dev --mode record
```

Paid runs follow the project's protocol: check the budget (`npm run eval:ledger total`), ledger
what was spent, and commit the new recordings. The steps are in the `demo-e2e` and `eval-bench`
skills (`.claude/skills/`).

## 6. Mixing live and recorded sources

`npm run demo:live` reads three variables from your shell before it starts, so you can make any
one source recorded:

| Variable | Values | `demo:live` default |
| --- | --- | --- |
| `LLM_MODE` | `live`, `record`, `replay` | `live` |
| `AIS_MODE` | `live`, `replay`, `off` | `live` |
| `WEATHER_MODE` | `live`, `recorded` | `live` |

```bash
AIS_MODE=replay npm run demo:live
```

That gives the live model and live weather with the recorded ships, on the wall clock. It is useful
when the AIS feed is down but you still want a live demo. `npm run demo:reset` takes only
`LLM_MODE` from your shell; its AIS and weather are always recorded.

## 7. Developer setups

Keep the backend in Docker and run the part you are changing from source.

**The console with hot reload.** The dev server proxies `/api` to the API on port 4000. Either stop
the `web` container and use its port:

```bash
docker compose stop web
```

```bash
npm run dev:web
```

or keep the built console running and start the dev server beside it on port 5174:

```bash
npm run dev -w @pharos/web -- --port 5174 --strictPort
```

**The API from source.** Run Postgres and the ERP simulator in Docker, stop the `api` and `worker`
containers, and start the API with `tsx watch`:

```bash
docker compose up -d db erp
```

```bash
docker compose stop api worker
```

```bash
DATABASE_URL=postgres://pharos:pharos@localhost:5432/pharos LLM_MODE=replay DEMO_ANCHOR=2026-11-14T08:00:00Z SEED_ON_BOOT=reset npm run dev:api
```

`npm run dev:api` does not load `.env`; it reads only the variables you give it. Those four are the
recorded demo: without `LLM_MODE` it defaults to `live` (and refuses to start without a key), and
without `DEMO_ANCHOR` the recorded replies do not match. `npm run dev:erp` runs the ERP simulator
from source the same way, and `npm run start -w @pharos/worker` the worker.

**After changing code**, the containers still run the images built earlier. Rebuild before you
trust what the console at port 5173 shows:

```bash
docker compose build && npm run demo:reset
```

Every variable each service reads is in the
[configuration reference](DEVELOPMENT.md#configuration-reference).

## Running the checks

None of these need a key. Details are in [`DEVELOPMENT.md`](DEVELOPMENT.md).

| What | Command | Notes |
| --- | --- | --- |
| Everything at once | `npm run verify` | Typecheck, lint, domain purity and all tests. Start the `db` container first for the database tests |
| The demo stories | `npm run demo:reset && npx playwright test` | Both stories on the recorded demo, about 30 seconds. Run `npx playwright install chromium` once first |
| Evaluation graders | `npm run eval -- --suite qa --split dev --oracle` | Feeds the truth through the graders (about 100 %); `--empty` gives about 0 % |
| Evaluation on recorded replies | `npm run eval -- --suite qa --split dev --mode replay` | Free, but only as good as the recordings: see the note below |

Run one test command at a time. The database tests give each test file its own database, and two
runs at once overwrite each other's data and fail for no real reason.

**The evaluation replays are partly out of date (20 Nov 2026).** Most extraction replays were
recorded for an earlier extraction prompt, so `--suite extraction --mode replay` misses on 92 of
the 114 dev cases (22 were re-recorded before the re-record pass was stopped). The Q&A replays miss on seven questions (`compliance-01`, `-02`, `route-speed-01`, `-02`,
`-03`, `-09`, `-10`): those plans changed when the provisions rule came in. `--oracle` and `--empty`
are unaffected. Re-recording them is a paid run (mode 5).

## How to tell which mode you are in

| Where | What it shows |
| --- | --- |
| Top bar, **AIS** and **Weather** badges | `live` or `recorded` per source (from `GET /api/sources`) |
| Top bar, **sim** clock | The world's time; **pinned** on the recorded demo |
| Assistant panel badge | **model: recorded** (replay), **model: recording** (record) or **model: live** |
| `curl -s localhost:4000/api/health` | `llmMode`: `replay`, `record` or `live`, and the two model names |
| `curl -s localhost:4000/api/clock` | `"pinned": true` on the recorded demo |
| `curl -s localhost:4000/api/sources` | Each source's mode, with a detail line (for live AIS, whether the socket is up) |

## Stopping and cleaning up

```bash
docker compose stop
```

Stops the containers and keeps them. `docker compose start` brings them back in the same mode.

```bash
docker compose down
```

Removes the containers and keeps the database volume. The next start reseeds the world anyway,
because the API reseeds on every boot in Docker.

```bash
docker compose down -v
```

Also deletes the database volume, test databases included. Use it only for a completely fresh
start.

Containers keep the mode they were created with. A plain `docker compose up -d` recreates any
container whose configuration changed, using your `.env` and Compose's defaults (the recorded demo,
Scenario read-only). So after `npm run demo:live`, running `docker compose up -d` by hand quietly
takes you back to the recorded demo. Switch with the two scripts, so the mode is always the one you
asked for.

## Common problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| "This question has no recorded reply" on a scripted question | An extra or failed "Plan route", or steps out of order | `npm run demo:reset`, then start from step 1 |
| The same message on your own question | The recorded demo only has the scripted questions | Use mode 4 or mode 3 |
| The Scenario panel shows the world but refuses edits | Started with a plain `docker compose up`, or the clock is live | `npm run demo:reset` |
| A code change does not show at port 5173 | The containers run the images built earlier | `docker compose build && npm run demo:reset` |
| `npm run dev:web` says port 5173 is in use | The `web` container holds it | `docker compose stop web`, or use port 5174 |
| `[api] refusing to start: LLM_MODE=live needs ANTHROPIC_API_KEY` | A live or record model without a key | Add the key to `.env`, or `npm run demo:reset` |
| The AIS badge reads "recorded" in live mode | No `AISSTREAM_API_KEY`, or the feed is down | Add the key; check with `npm run smoke:ais -- --seconds 20` |
| `demo stack not ready after 180 s` | A container failed to start | `docker compose logs api` (or `worker`, `web`) shows why |
| Database tests are skipped | Postgres is not running on port 5432 | `docker compose up -d db` |
| Tests fail with missing rows or odd counts | Two test runs at once | Run one at a time, then rerun the failing file alone |

More, for development, in [`DEVELOPMENT.md`](DEVELOPMENT.md#troubleshooting).
