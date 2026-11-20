# Extraction scorecard: dev / oracle-final

- Mode: oracle; extractor: oracle; no model calls
- Prompt version: oracle
- World: seed 20261114, anchor 2026-11-14T08:00:00.000Z
- Started 2026-11-15T03:31:32.474Z, finished 2026-11-15T03:31:33.552Z
- Cases: 84 selected, 84 run, 84 graded, 0 errors
- Served models: none (no model calls)
- Spend: llm_calls $0.000000; nothing ledgered (no live calls)

## Headline (first run of each case; errors excluded)

| Metric | k/N | Rate | 95 % CI (Wilson) |
|---|---:|---:|---:|
| Critical-field accuracy | 651/651 | 100.0 % | 99.4–100.0 % |
| Unsafe auto-accepts | 0/84 | 0.0 % | 0.0–4.4 % |
| Quote precision | 71/71 | 100.0 % | 94.9–100.0 % |
| Quote recall | 71/71 | 100.0 % | 94.9–100.0 % |
| Not-a-quote precision | 13/13 | 100.0 % | 77.2–100.0 % |
| Not-a-quote recall | 13/13 | 100.0 % | 77.2–100.0 % |
| Review-queue rate | 16/84 | 19.0 % | 12.1–28.7 % |
| False-review rate | 0/55 | 0.0 % | 0.0–6.5 % |
| Needs-review recall | 16/16 | 100.0 % | 80.6–100.0 % |
| Review check matched | 16/16 | 100.0 % | 80.6–100.0 % |

Critical fields: 0 wrong, 0 missing, over 70 truth-quote cases.
Unsafe auto-accepts: none.
False reviews: none.
Truth needs_review but not sent to review: none.
Review expected but no listed check failed: none.

## Per-field accuracy

| Field | Critical | k/N | Rate | 95 % CI | Wrong | Missing |
|---|---|---:|---:|---:|---:|---:|
| vessel | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| port | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| supplier | no | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| currency | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| validUntil | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| deliveryFrom | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| deliveryTo | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| bargeFee | no | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| grade | yes | 77/77 | 100.0 % | 95.2–100.0 % | 0 | 0 |
| quantity | yes | 77/77 | 100.0 % | 95.2–100.0 % | 0 | 0 |
| price | yes | 77/77 | 100.0 % | 95.2–100.0 % | 0 | 0 |

## Error clusters (field misses, with case ids)

None.

## Errors (not graded, not wrong answers)

None.

## Graded failures (status failed; nothing extracted)

None.

## Latency and cost (first runs, errors included)

| | n | Mean | p90 | Target |
|---|---:|---:|---:|---:|
| Latency per email (ingest + processing) | 84 | 0.0 s | 0.0 s | 20.0 s |
| Model latency per email (llm_calls) | 84 | 0.0 s | 0.0 s | |
| Cost per email (llm_calls) | 84 | $0.000000 | $0.000000 | |

Total cost of every run, repeats included: $0.000000.

