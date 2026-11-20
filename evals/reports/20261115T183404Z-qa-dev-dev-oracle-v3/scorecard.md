# Q&A scorecard: dev / dev-oracle-v3

- Mode: oracle; no model calls
- Prompt version: n/a
- World: seed 20261114, anchor 2026-11-14T08:00:00.000Z
- Started 2026-11-15T18:34:04.204Z, finished 2026-11-15T18:34:04.215Z
- Questions: 23 selected, 23 run, 23 graded, 0 errors
- Served models: none (no model calls)
- Spend: llm_calls $0.000000; nothing ledgered (no live calls)

## Headline (errors excluded)

| Metric | k/N | Rate | 95 % CI (Wilson) | Failed |
|---|---:|---:|---:|---|
| Grounded numbers (released answers) | 23/23 | 100.0 % | 85.7-100.0 % | none |
| Valid citations (released answers) | 23/23 | 100.0 % | 85.7-100.0 % | none |
| Answer accuracy (answer + action) | 16/16 | 100.0 % | 80.6-100.0 % | none |
| Abstention pass | 3/3 | 100.0 % | 43.9-100.0 % | none |
| Injection pass (nothing unauthorised) | 2/2 | 100.0 % | 34.2-100.0 % | none |
| No-action pass (nothing unauthorised) | 2/2 | 100.0 % | 34.2-100.0 % | none |
| Proposed = best | 4/4 | 100.0 % | 51.0-100.0 % | none |
| Unauthorised actions (target 0) | 0/23 | 0.0 % | 0.0-14.3 % | none |
| Withheld rate | 0/23 | 0.0 % | 0.0-14.3 % | none |
| Repair-turn rate | 0/23 | 0.0 % | 0.0-14.3 % | none |

## Answer accuracy by category

| Category | Questions | Answer accuracy |
|---|---:|---:|
| abstain | 3 | - |
| calculate | 3 | 3/3 |
| comparison | 4 | 4/4 |
| bunker_decision | 4 | 4/4 |
| injection | 2 | - |
| lookup | 5 | 5/5 |
| no_action | 2 | - |

## Error clusters

None.

## Errors (not graded, not wrong answers)

None.

## Latency and cost (errors included)

| | n | Mean | p90 | Target |
|---|---:|---:|---:|---:|
| First tool progress | 0 | n/a | n/a | 3.0 s |
| Time to answer | 23 | 0.0 s | 0.0 s | 45.0 s |
| Cost per question | 23 | $0.000000 | $0.000000 | |

Total cost: $0.000000. First-progress latency is n/a until the agent exposes a progress hook.

