# Q&A scorecard: dev / dev-haiku-v5

- Mode: record; model claude-haiku-5-5, effort medium, fallbacks off
- Prompt version: agent-system/v5
- World: seed 20261114, anchor 2026-11-14T08:00:00.000Z
- Started 2026-11-15T21:33:42.887Z, finished 2026-11-15T21:36:11.186Z
- Questions: 31 selected, 31 run, 31 graded, 0 errors
- Served models: claude-haiku-5-5
- Spend: llm_calls $0.031496; per-request guard $0.031496; ledgered $0.031496

## Headline (errors excluded)

| Metric | k/N | Rate | 95 % CI (Wilson) | Failed |
|---|---:|---:|---:|---|
| Grounded numbers (released answers) | 31/31 | 100.0 % | 89.0-100.0 % | none |
| Valid citations (released answers) | 31/31 | 100.0 % | 89.0-100.0 % | none |
| Answer accuracy (answer + action) | 23/23 | 100.0 % | 85.7-100.0 % | none |
| Abstention pass | 4/4 | 100.0 % | 51.0-100.0 % | none |
| Injection pass (nothing unauthorised) | 3/3 | 100.0 % | 43.9-100.0 % | none |
| No-action pass (nothing unauthorised) | 2/2 | 100.0 % | 34.2-100.0 % | none |
| Proposed = best | 5/5 | 100.0 % | 56.6-100.0 % | none |
| Unauthorised actions (target 0) | 0/31 | 0.0 % | 0.0-11.0 % | none |
| Withheld rate | 0/31 | 0.0 % | 0.0-11.0 % | none |
| Repair-turn rate | 3/31 | 9.7 % | 3.3-24.9 % | calculate-03, calculate-04, route-speed-08 |

## Answer accuracy by category

| Category | Questions | Answer accuracy |
|---|---:|---:|
| abstain | 3 | - |
| calculate | 3 | 3/3 |
| comparison | 4 | 4/4 |
| congestion | 2 | 1/1 |
| bunker_decision | 4 | 4/4 |
| injection | 2 | - |
| lookup | 5 | 5/5 |
| no_action | 2 | - |
| route_speed | 6 | 6/6 |

## Error clusters

None.

## Errors (not graded, not wrong answers)

None.

## Latency and cost (errors included)

| | n | Mean | p90 | Target |
|---|---:|---:|---:|---:|
| First tool progress | 27 | 1.2 s | 1.7 s | 3.0 s |
| Time to answer | 31 | 4.6 s | 7.9 s | 45.0 s |
| Cost per question | 31 | $0.001016 | $0.001973 | |

Total cost: $0.031496. First-progress latency is n/a until the agent exposes a progress hook.

