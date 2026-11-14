---
name: eval-bench
description: Add golden cases, run the Pharos extraction or Q&A benchmark, read the scorecard, do error analysis, and follow the prompt-change protocol. Use whenever accuracy is measured, a prompt or extraction schema changes, or a golden case is added.
---

# Eval bench

Full strategy: `docs/MASTER_PLAN.md` §7. Results log: `docs/EVAL_LOG.md`.

## Add a golden case

1. Write the truth first: `evals/golden/<suite>/<id>.truth.json`, validated by the suite's Zod schema.
2. Render or hand-write the input next to it (`<id>.eml` / `<id>.pdf`). Generated inputs come from the truth through templates — never the reverse.
3. Tag it (`tags[0]` = category) and assign the split by running `npm run eval:split` (random, stratified, stable). Never hand-pick splits.
4. Truth files are edit-protected. To correct a wrong label: show the user the evidence; if they agree, create `.claude/state/golden-unlock.local.json` with the reason, edit, then delete the unlock file.

## Run

- Free, deterministic: `npm run eval -- --suite extraction --mode replay`
- Paid smoke (a few dev cases, cents): `npm run eval:smoke`
- Paid dev pass: `npm run eval -- --suite extraction --split dev --mode live`
- Final held-out pass: **once, in Phase 7 only.**
- Before the first paid run of a suite: run the oracle and empty baselines (`--oracle`, `--empty`) and confirm ≈100% / ≈0%.

## Read the scorecard (`evals/reports/<run>/scorecard.json`)

- Headline metrics with k/N and 95% intervals; errors (API, truncation, refusal) are listed separately and are **not** wrong answers.
- Recompute the headline from `rows.jsonl` if anything looks surprising.

## Error analysis

Cluster failures by field and cause (wrong value / missing / wrong entity / should-have-reviewed). Quote case IDs. Read at least five failing transcripts before proposing a prompt change.

## Prompt-change protocol

1. One hypothesis per change, written in `docs/EVAL_LOG.md` before running.
2. Iterate on **dev only**. Never look at held-out failures.
3. Keep a change only if dev improves beyond run-to-run noise without regressions in critical fields.
4. Log: date, change, dev score before → after, cost.
