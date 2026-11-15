# Extraction scorecard: dev / dev-haiku-gate-final-replay

- Mode: replay; extractor: llm; model claude-haiku-5-5, effort medium, fallbacks off
- Prompt version: extract-quote/v2
- World: seed 20261114, anchor 2026-11-14T08:00:00.000Z
- Started 2026-11-15T03:39:54.690Z, finished 2026-11-15T03:39:56.042Z
- Cases: 84 selected, 84 run, 84 graded, 0 errors
- Served models: claude-haiku-5-5
- Spend: llm_calls $0.061281; nothing ledgered (no live calls)
- Latency in replay is not a measurement of the model; read it from the recorded run.

## Headline (first run of each case; errors excluded)

| Metric | k/N | Rate | 95 % CI (Wilson) |
|---|---:|---:|---:|
| Critical-field accuracy | 646/651 | 99.2 % | 98.2–99.7 % |
| Unsafe auto-accepts | 0/84 | 0.0 % | 0.0–4.4 % |
| Quote precision | 70/70 | 100.0 % | 94.8–100.0 % |
| Quote recall | 70/71 | 98.6 % | 92.4–99.8 % |
| Not-a-quote precision | 13/14 | 92.9 % | 68.5–98.7 % |
| Not-a-quote recall | 13/13 | 100.0 % | 77.2–100.0 % |
| Review-queue rate | 21/84 | 25.0 % | 17.0–35.2 % |
| False-review rate | 5/55 | 9.1 % | 3.9–19.6 % |
| Needs-review recall | 16/16 | 100.0 % | 80.6–100.0 % |
| Review check matched | 16/16 | 100.0 % | 80.6–100.0 % |

Critical fields: 0 wrong, 5 missing, over 70 truth-quote cases.
Unsafe auto-accepts: none.
False reviews: hard-eur-quote-in-band-v2, multi-grade-003, pdf-009, plain-003, plain-021.
Truth needs_review but not sent to review: none.
Review expected but no listed check failed: none.

## Per-field accuracy

| Field | Critical | k/N | Rate | 95 % CI | Wrong | Missing |
|---|---|---:|---:|---:|---:|---:|
| vessel | yes | 69/70 | 98.6 % | 92.3–99.7 % | 0 | 1 |
| port | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| supplier | no | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| currency | yes | 69/70 | 98.6 % | 92.3–99.7 % | 0 | 1 |
| validUntil | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| deliveryFrom | yes | 68/70 | 97.1 % | 90.2–99.2 % | 0 | 2 |
| deliveryTo | yes | 69/70 | 98.6 % | 92.3–99.7 % | 0 | 1 |
| bargeFee | no | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| grade | yes | 77/77 | 100.0 % | 95.2–100.0 % | 0 | 0 |
| quantity | yes | 77/77 | 100.0 % | 95.2–100.0 % | 0 | 0 |
| price | yes | 77/77 | 100.0 % | 95.2–100.0 % | 0 | 0 |

## Error clusters (field misses, with case ids)

- deliveryFrom missing (2): multi-grade-003, plain-021
- vessel missing (1): plain-003
- currency missing (1): hard-eur-quote-in-band-v2
- deliveryTo missing (1): pdf-009

## Errors (not graded, not wrong answers)

None.

## Graded failures (status failed; nothing extracted)

None.

## Latency and cost (first runs, errors included)

| | n | Mean | p90 | Target |
|---|---:|---:|---:|---:|
| Latency per email (ingest + processing) | 84 | 0.0 s | 0.0 s | 20.0 s |
| Model latency per email (llm_calls) | 84 | 0.0 s | 0.0 s | |
| Cost per email (llm_calls) | 84 | $0.000730 | $0.000972 | |

Total cost of every run, repeats included: $0.061281.

