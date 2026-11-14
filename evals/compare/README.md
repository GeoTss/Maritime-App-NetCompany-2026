# Agent model comparison

A live comparison of the ops agent (`AGENT_MODEL`) across models on seven harder questions
(`questions.ts`: demo, trap, follow-up, status, fleet, pressure, unknown vessel). Extraction is not
part of it. The questions are inputs only; there is no reference answer and **no accuracy score is
computed**. Outcomes are release-gate and tool facts; answer quality is for human review.

## Run

```bash
npm run eval:compare -- [--models claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5] \
                        [--questions q1,q2,...] [--label name]
```

Needs `ANTHROPIC_API_KEY` in `.env` (loaded by `tsx --env-file=.env`; never printed) and Postgres up
(`docker compose up -d db`). The runner exits at once if the variable is absent. `--questions q3`
also runs q1, because q3 asks inside q1's conversation.

It runs in-process: per model a fresh database (`pharos_test_compare`, shared with `run.test.ts`:
the CLI and the test must not run at the same time; seed 20261114, anchor
2026-11-14T08:00:00Z, the two demo quotes inserted as in `ask/demo-fixture.ts`), the clock at the
anchor, `createLlm` in live mode, effort `medium`, fallbacks off, and each question through
`POST /api/ask` on the in-process app.

## Cost and caps

Before the first call it prints a per-model estimate (an assumed 4 calls of 5,000 input and 1,200
output tokens per question, priced from `apps/api/src/ai/pricing.ts`; a rough guide, not a quote).
Caps: a model stops once its running cost exceeds **$1.00**, the run stops once the total exceeds
**$2.00**. They are checked **before every model request**, through the transport: it sums each
response's cost from its `usage` (same rate table as `llm_calls`) and, once a cap is crossed,
refuses the next request without touching the network. The in-flight ask then fails fast (outcome
`error`, kind `spend_cap`, "stopped: cap" with the amounts), so overrun is bounded to **one
in-flight request**. Remaining questions are recorded as `skipped` with the reason, and listed under
Stops. Costs of failed asks count. The reported cost is the database figure; the report says
whether the guard's sum agrees with it.

## What is measured (code only)

Per (model, question): outcome (`answered` gate passed with no repair, `repaired`, `withheld`,
`error` with kind: api_error / refusal / truncation / iteration_limit / ...); wall latency; LLM
calls, tokens and cost from `llm_calls`; the model each response names (asserted equal to the
requested one); tools called in order (stored `tool` messages); fact count and cited-fact count;
each recommendation's `optionId` and whether it equals the calculation's `bestOptionId`; the answer,
or for withheld answers the stored text and the ungrounded numbers.

## Output

`evals/reports/<UTC stamp>-agent-compare-<label>/`: `report.json`, `report.md` (per-model summary,
side-by-side table, every answer in full) and `transcripts.json` (stored messages per ask).

`run.test.ts` is the dry test: scripted transport, real agent, route and database, no network.
