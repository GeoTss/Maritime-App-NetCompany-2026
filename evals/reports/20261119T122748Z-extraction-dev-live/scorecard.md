# Extraction scorecard: dev / live

- Mode: live; extractor: llm; model claude-haiku-5-5, effort medium, fallbacks off
- Prompt version: extract-quote/v4
- World: seed 20261114, anchor 2026-11-14T08:00:00.000Z
- Started 2026-11-19T12:27:48.671Z, finished 2026-11-19T12:38:33.637Z
- Cases: 114 selected, 114 run, 114 graded, 0 errors
- Served models: claude-haiku-5-5
- Spend: llm_calls $0.091274; per-request guard $0.091274; ledgered $0.091274

## Headline (first run of each case; errors excluded)

Fuel quotes and not-a-quote emails. The 30 Track 3 security quotes are scored in their own section below (quote and not-a-quote precision still count every email).

| Metric | k/N | Rate | 95 % CI (Wilson) |
|---|---:|---:|---:|
| Critical-field accuracy | 649/651 | 99.7 % | 98.9–99.9 % |
| Unsafe auto-accepts | 0/84 | 0.0 % | 0.0–4.4 % |
| Quote precision | 70/70 | 100.0 % | 94.8–100.0 % |
| Quote recall | 70/71 | 98.6 % | 92.4–99.8 % |
| Not-a-quote precision | 13/14 | 92.9 % | 68.5–98.7 % |
| Not-a-quote recall | 13/13 | 100.0 % | 77.2–100.0 % |
| Review-queue rate | 18/84 | 21.4 % | 14.0–31.3 % |
| False-review rate | 2/55 | 3.6 % | 1.0–12.3 % |
| Needs-review recall | 16/16 | 100.0 % | 80.6–100.0 % |
| Review check matched | 16/16 | 100.0 % | 80.6–100.0 % |

Critical fields: 0 wrong, 2 missing, over 70 truth-quote cases.
Unsafe auto-accepts: none.
False reviews: html-024, plain-003.
Truth needs_review but not sent to review: none.
Review expected but no listed check failed: none.

## Security quotes (Track 3; first runs, errors excluded)

| Metric | k/N | Rate | 95 % CI (Wilson) |
|---|---:|---:|---:|
| Security critical-field accuracy | 234/243 | 96.3 % | 93.1–98.0 % |
| Unsafe auto-accepts | 0/30 | 0.0 % | 0.0–11.4 % |
| Security-quote precision | 30/30 | 100.0 % | 88.6–100.0 % |
| Security-quote recall | 30/30 | 100.0 % | 88.6–100.0 % |
| Review-queue rate | 4/30 | 13.3 % | 5.3–29.7 % |
| False-review rate | 1/27 | 3.7 % | 0.7–18.3 % |
| Needs-review recall | 3/3 | 100.0 % | 43.9–100.0 % |
| Review check matched | 3/3 | 100.0 % | 43.9–100.0 % |

Security critical fields: 0 wrong, 9 missing, over 27 graded field sets (30 security cases; a needs_review truth sent to review has no stored record and no field grades).
Unsafe auto-accepts: none.
False reviews: security-hard-eur-day-rate-a.
Truth needs_review but not sent to review: none.
Review expected but no listed check failed: none.

| Security field | Critical | k/N | Rate | 95 % CI | Wrong | Missing |
|---|---|---:|---:|---:|---:|---:|
| provider | no | 26/27 | 96.3 % | 81.7–99.3 % | 0 | 1 |
| vessel | yes | 26/27 | 96.3 % | 81.7–99.3 % | 0 | 1 |
| embarkPort | yes | 26/27 | 96.3 % | 81.7–99.3 % | 0 | 1 |
| disembarkPort | yes | 26/27 | 96.3 % | 81.7–99.3 % | 0 | 1 |
| teamSize | yes | 26/27 | 96.3 % | 81.7–99.3 % | 0 | 1 |
| dayRate | yes | 26/27 | 96.3 % | 81.7–99.3 % | 0 | 1 |
| currency | yes | 26/27 | 96.3 % | 81.7–99.3 % | 0 | 1 |
| fixedFees | yes | 26/27 | 96.3 % | 81.7–99.3 % | 0 | 1 |
| minDays | yes | 26/27 | 96.3 % | 81.7–99.3 % | 0 | 1 |
| validUntil | yes | 26/27 | 96.3 % | 81.7–99.3 % | 0 | 1 |

Security error clusters (field misses, with case ids):

- provider missing (1): security-hard-eur-day-rate-a
- vessel missing (1): security-hard-eur-day-rate-a
- embarkPort missing (1): security-hard-eur-day-rate-a
- disembarkPort missing (1): security-hard-eur-day-rate-a
- teamSize missing (1): security-hard-eur-day-rate-a
- dayRate missing (1): security-hard-eur-day-rate-a
- currency missing (1): security-hard-eur-day-rate-a
- fixedFees missing (1): security-hard-eur-day-rate-a
- minDays missing (1): security-hard-eur-day-rate-a
- validUntil missing (1): security-hard-eur-day-rate-a

Cost per security email (llm_calls): mean $0.000880, p90 $0.001022.

## Per-field accuracy

| Field | Critical | k/N | Rate | 95 % CI | Wrong | Missing |
|---|---|---:|---:|---:|---:|---:|
| vessel | yes | 69/70 | 98.6 % | 92.3–99.7 % | 0 | 1 |
| port | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| supplier | no | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| currency | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| validUntil | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| deliveryFrom | yes | 69/70 | 98.6 % | 92.3–99.7 % | 0 | 1 |
| deliveryTo | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| bargeFee | no | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| grade | yes | 77/77 | 100.0 % | 95.2–100.0 % | 0 | 0 |
| quantity | yes | 77/77 | 100.0 % | 95.2–100.0 % | 0 | 0 |
| price | yes | 77/77 | 100.0 % | 95.2–100.0 % | 0 | 0 |

## Error clusters (field misses, with case ids)

- vessel missing (1): plain-003
- deliveryFrom missing (1): html-024

## Errors (not graded, not wrong answers)

None.

## Graded failures (status failed; nothing extracted)

None.

## Latency and cost (first runs, errors included)

| | n | Mean | p90 | Target |
|---|---:|---:|---:|---:|
| Latency per email (ingest + processing) | 114 | 5.6 s | 7.5 s | 20.0 s |
| Model latency per email (llm_calls) | 114 | 5.6 s | 7.4 s | |
| Cost per email (llm_calls) | 114 | $0.000801 | $0.001022 | |

Total cost of every run, repeats included: $0.091274.

