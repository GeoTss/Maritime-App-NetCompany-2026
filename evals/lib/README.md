# Eval spend controls

`budget.ts` holds the per-phase live-spend budget and the Haiku-only guard.

- `evals/budget.json`: `{ "phase", "capUsd" }`, the current phase and its cap. A cap of `0` means
  the user has not set the budget yet: `assertBudget` refuses any positive estimate.
- `evals/spend-ledger.jsonl`: one JSON row `{phase?, at, run, label, costUsd}` per live run. A row
  without `phase` is Phase 3's (Phase 3's $3.00 no longer applies to later phases). Every live
  runner calls `assertBudget(estimate)` before its first request and `appendSpend(row)` afterwards,
  which stamps the current phase. `ledgerTotal(path, phase)` sums one phase only.
- `assertHaikuOnly(models)`: throws unless every model is exactly `claude-haiku-5-5`.
- `createSpendGuard({ capUsd, onRequest, onCost, allowedModel })`: wraps an LLM transport, sums
  each response's cost and answers the next request with a synthetic 400 once over the cap
  (overrun bounded to one request). With `allowedModel`, the first response served by another
  model trips it too (`trip().source === "model"`), so the next request is refused.
- Every function takes an optional ledger path; tests use temp files, never the real ledger.

```bash
npm run eval:ledger -- total        # the current phase's total and what remains of its cap
npm run eval:ledger -- add --run <run> --label <label> --cost <usd>
```
