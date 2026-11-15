# Extraction scorecard: dev / dev-haiku-v2-gate

- Mode: record; extractor: llm; model claude-haiku-5-5, effort medium, fallbacks off
- Prompt version: extract-quote/v2
- World: seed 20261114, anchor 2026-11-14T08:00:00.000Z
- Started 2026-11-15T03:21:17.781Z, finished 2026-11-15T03:29:02.305Z
- Cases: 84 selected, 84 run, 84 graded, 0 errors
- Served models: claude-haiku-5-5
- Spend: llm_calls $0.062191; per-request guard $0.062191; ledgered $0.062191

## Headline (first run of each case; errors excluded)

| Metric | k/N | Rate | 95 % CI (Wilson) |
|---|---:|---:|---:|
| Critical-field accuracy | 616/651 | 94.6 % | 92.6–96.1 % |
| Unsafe auto-accepts | 0/84 | 0.0 % | 0.0–4.4 % |
| Quote precision | 70/70 | 100.0 % | 94.8–100.0 % |
| Quote recall | 70/71 | 98.6 % | 92.4–99.8 % |
| Not-a-quote precision | 13/14 | 92.9 % | 68.5–98.7 % |
| Not-a-quote recall | 13/13 | 100.0 % | 77.2–100.0 % |
| Review-queue rate | 43/84 | 51.2 % | 40.7–61.6 % |
| False-review rate | 27/55 | 49.1 % | 36.4–61.9 % |
| Needs-review recall | 16/16 | 100.0 % | 80.6–100.0 % |
| Review check matched | 16/16 | 100.0 % | 80.6–100.0 % |

Critical fields: 0 wrong, 35 missing, over 70 truth-quote cases.
Unsafe auto-accepts: none.
False reviews: eur-003, eur-018, eur-021, forwarded-002, forwarded-011, forwarded-014, hard-injection-override, hard-injection-override-v2, hard-thread-stale-revision-v2, html-007, html-017, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-009, multi-grade-019, pdf-012, plain-003, plain-007, plain-013, plain-014, plain-021, plain-027, plain-036.
Truth needs_review but not sent to review: none.
Review expected but no listed check failed: none.

## Per-field accuracy

| Field | Critical | k/N | Rate | 95 % CI | Wrong | Missing |
|---|---|---:|---:|---:|---:|---:|
| vessel | yes | 69/70 | 98.6 % | 92.3–99.7 % | 0 | 1 |
| port | yes | 42/70 | 60.0 % | 48.3–70.7 % | 0 | 28 |
| supplier | no | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| currency | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| validUntil | yes | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| deliveryFrom | yes | 67/70 | 95.7 % | 88.1–98.5 % | 0 | 3 |
| deliveryTo | yes | 68/70 | 97.1 % | 90.2–99.2 % | 0 | 2 |
| bargeFee | no | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| grade | yes | 77/77 | 100.0 % | 95.2–100.0 % | 0 | 0 |
| quantity | yes | 77/77 | 100.0 % | 95.2–100.0 % | 0 | 0 |
| price | yes | 76/77 | 98.7 % | 93.0–99.8 % | 0 | 1 |

## Error clusters (field misses, with case ids)

- port missing (28): eur-003, eur-018, eur-021, forwarded-002, forwarded-011, forwarded-014, hard-injection-override-v2, hard-qty-over-tank-capacity-v2, hard-spoofed-supplier-name-v2, hard-thread-stale-revision-v2, hard-unknown-vessel-v2, html-007, html-017, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-009, multi-grade-019, pdf-012, plain-003, plain-007, plain-013, plain-014, plain-021, plain-036
- deliveryFrom missing (3): hard-injection-override, html-024, plain-027
- deliveryTo missing (2): hard-injection-override, plain-027
- vessel missing (1): plain-003
- price missing (1): html-023

## Errors (not graded, not wrong answers)

None.

## Graded failures (status failed; nothing extracted)

None.

## Latency and cost (first runs, errors included)

| | n | Mean | p90 | Target |
|---|---:|---:|---:|---:|
| Latency per email (ingest + processing) | 84 | 5.5 s | 7.4 s | 20.0 s |
| Model latency per email (llm_calls) | 84 | 5.5 s | 7.4 s | |
| Cost per email (llm_calls) | 84 | $0.000740 | $0.000982 | |

Total cost of every run, repeats included: $0.062191.

