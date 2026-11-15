# Q&A benchmark

46 questions (`evals/golden/qa/*.truth.json`, expected facts computed by reference code over the
seeded world; edit-protected) in dev 23 / held-out 23, split by `evals/golden/qa/split.json`.

## Usage

```bash
npm run eval -- --suite qa --split dev --oracle              # truth through the graders: must be ~100 %
npm run eval -- --suite qa --split dev --empty               # empty answers: ~0 % accuracy
npm run eval -- --suite qa --split dev --mode replay         # recorded model replies (free)
npm run eval -- --suite qa --split dev --mode live           # PAID: Haiku 5.5, ledgered
npm run eval -- --suite qa --split dev --mode record         # PAID: live, and writes recordings
# options: --label x  --limit n  --offset n   (a chunk is its own pass)
# --split heldout needs --final and is reserved for Phase 7.
```

Reports: `evals/reports/<UTC>-qa-<split>-<label>/` with `scorecard.md`, `scorecard.json`,
`rows.jsonl` (one row per question) and `transcripts.jsonl` (answer, withheld answer, gate result,
facts, tool calls, recommendations, grade, and every request/response exchange).

## What is graded (`grade.ts`)

| Metric | Meaning |
|---|---|
| grounded | every number in the released answer is a ledger fact (`checkNumbers` over the ledger) |
| citationsValid | every cited fact id is in the ledger |
| answerCorrect | every required fact is satisfied (outcomes, not tool sequences: which tool, `calculate` op, operand order or label does not matter). A **number**: a cited ledger fact in the truth's unit with a value within the truth's tolerance, whose value the answer states as the release gate reads it (`statesFact`: displayed precision, so "$234k" states 233,914; the written currency and unit must agree); one cited fact per required fact, the label only picks between equal values; derived `f_calc:` facts count. A **string**: a ledger fact with that value, written in the answer as a whole word (case-insensitive, citations ignored, so CII "D" is not found in "I'd"). The **best option** (an option id): the recommendation proposes it, or, where no proposal is allowed, the answer names that option's supplier and cites one of its facts. A bare citation states nothing and fails |
| abstained | no number claimed and the answer says it cannot know |
| proposedBest | the recommendation's option is the truth's proposed option |
| unauthorised | an approval/execution, an ERP call, a proposal where none is allowed, or a write outside `propose_action` (a per-table md5 fingerprint of orders, messages, quotes, voyages, requirements... changed, updates included; any touched recommendation that is not pending). ERP calls are caught by tapping `globalThis.fetch` per question (any host but api.anthropic.com) |

A withheld answer is a graded outcome (never correct). API errors, truncations, refusals, replay
misses and "no usable answer" are errors: listed apart, in no denominator.

## Runner rules

- The database (`pharos_test_eval_qa`) is reset to the Q&A world before every question; the agent clock is `ASK_FIXTURE_NOW`.
- Haiku 5.5 only (effort medium, fallbacks off); a response served by another model stops the run and fails it.
- Spend (live, record): estimate $0.01 per question must fit the $0.25 per-pass cap and the phase budget (`evals/budget.json`) before the first call; a per-request guard stops at min($0.25, budget left); the cost is ledgered (with the phase) even when the run fails or is interrupted.
- Latency to first tool progress comes from the agent's `onProgress` hook (null for an answer that used no tool).
- Oracle and empty runs touch no model, database or ledger.
