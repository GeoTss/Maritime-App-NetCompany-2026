# Extraction scorecard: dev / t3-security-oracle

- Mode: oracle; extractor: oracle; no model calls
- Prompt version: oracle
- World: seed 20261114, anchor 2026-11-14T08:00:00.000Z
- Started 2026-11-19T02:39:32.422Z, finished 2026-11-19T02:39:33.989Z
- Cases: 114 selected, 114 run, 114 graded, 0 errors
- Served models: none (no model calls)
- Spend: llm_calls $0.000000; nothing ledgered (no live calls)

## Headline (first run of each case; errors excluded)

Fuel quotes and not-a-quote emails. The 30 Track 3 security quotes are scored in their own section below (quote and not-a-quote precision still count every email).

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

## Security quotes (Track 3; first runs, errors excluded)

| Metric | k/N | Rate | 95 % CI (Wilson) |
|---|---:|---:|---:|
| Security critical-field accuracy | 243/243 | 100.0 % | 98.4–100.0 % |
| Unsafe auto-accepts | 0/30 | 0.0 % | 0.0–11.4 % |
| Security-quote precision | 30/30 | 100.0 % | 88.6–100.0 % |
| Security-quote recall | 30/30 | 100.0 % | 88.6–100.0 % |
| Review-queue rate | 3/30 | 10.0 % | 3.5–25.6 % |
| False-review rate | 0/27 | 0.0 % | 0.0–12.5 % |
| Needs-review recall | 3/3 | 100.0 % | 43.9–100.0 % |
| Review check matched | 3/3 | 100.0 % | 43.9–100.0 % |

Security critical fields: 0 wrong, 0 missing, over 27 graded field sets (30 security cases; a needs_review truth sent to review has no stored record and no field grades).
Unsafe auto-accepts: none.
False reviews: none.
Truth needs_review but not sent to review: none.
Review expected but no listed check failed: none.

| Security field | Critical | k/N | Rate | 95 % CI | Wrong | Missing |
|---|---|---:|---:|---:|---:|---:|
| provider | no | 27/27 | 100.0 % | 87.5–100.0 % | 0 | 0 |
| vessel | yes | 27/27 | 100.0 % | 87.5–100.0 % | 0 | 0 |
| embarkPort | yes | 27/27 | 100.0 % | 87.5–100.0 % | 0 | 0 |
| disembarkPort | yes | 27/27 | 100.0 % | 87.5–100.0 % | 0 | 0 |
| teamSize | yes | 27/27 | 100.0 % | 87.5–100.0 % | 0 | 0 |
| dayRate | yes | 27/27 | 100.0 % | 87.5–100.0 % | 0 | 0 |
| currency | yes | 27/27 | 100.0 % | 87.5–100.0 % | 0 | 0 |
| fixedFees | yes | 27/27 | 100.0 % | 87.5–100.0 % | 0 | 0 |
| minDays | yes | 27/27 | 100.0 % | 87.5–100.0 % | 0 | 0 |
| validUntil | yes | 27/27 | 100.0 % | 87.5–100.0 % | 0 | 0 |

Security error clusters (field misses, with case ids):

None.

Cost per security email (llm_calls): mean $0.000000, p90 $0.000000.

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
| Latency per email (ingest + processing) | 114 | 0.0 s | 0.0 s | 20.0 s |
| Model latency per email (llm_calls) | 114 | 0.0 s | 0.0 s | |
| Cost per email (llm_calls) | 114 | $0.000000 | $0.000000 | |

Total cost of every run, repeats included: $0.000000.

