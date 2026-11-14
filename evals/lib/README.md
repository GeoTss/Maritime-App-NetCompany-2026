# Eval spend controls (Phase 3)

`budget.ts` holds the $3.00 live-spend budget for Phase 3 and the Haiku-only guard.

- `evals/spend-ledger.jsonl`: one JSON row `{at, run, label, costUsd}` per live run. Committed
  **empty**; Phase 2's spend is not counted. Every live runner calls `assertBudget(estimate)` before
  its first request and `appendSpend(row)` afterwards.
- `assertHaikuOnly(models)`: throws unless every model is exactly `claude-haiku-5-5`.
- `createSpendGuard({ capUsd, onRequest, onCost, allowedModel })`: wraps an LLM transport, sums
  each response's cost and answers the next request with a synthetic 400 once over the cap
  (overrun bounded to one request). With `allowedModel`, the first response served by another
  model trips it too (`trip().source === "model"`), so the next request is refused.
- Every function takes an optional ledger path; tests use temp files, never the real ledger.

```bash
npm run eval:ledger -- total        # ledger total and what remains of $3.00
npm run eval:ledger -- add --run <run> --label <label> --cost <usd>
```
