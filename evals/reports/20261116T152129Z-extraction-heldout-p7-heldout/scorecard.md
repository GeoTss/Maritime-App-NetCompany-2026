# Extraction scorecard: heldout / p7-heldout

- Mode: live; extractor: llm; model claude-haiku-5-5, effort medium, fallbacks off
- Prompt version: extract-quote/v2
- World: seed 20261114, anchor 2026-11-14T08:00:00.000Z
- Started 2026-11-16T15:21:29.085Z, finished 2026-11-16T15:40:13.899Z
- Final pass (--final)
- Cases: 156 selected, 156 run, 156 graded, 0 errors; hard cases run 3 times
- Served models: claude-haiku-5-5
- Spend: llm_calls $0.131250; per-request guard $0.131250; ledgered $0.131250

## Headline (first run of each case; errors excluded)

| Metric | k/N | Rate | 95 % CI (Wilson) |
|---|---:|---:|---:|
| Critical-field accuracy | 1170/1182 | 99.0 % | 98.2–99.4 % |
| Unsafe auto-accepts | 0/156 | 0.0 % | 0.0–2.4 % |
| Quote precision | 126/126 | 100.0 % | 97.0–100.0 % |
| Quote recall | 126/127 | 99.2 % | 95.7–99.9 % |
| Not-a-quote precision | 29/30 | 96.7 % | 83.3–99.4 % |
| Not-a-quote recall | 29/29 | 100.0 % | 88.3–100.0 % |
| Review-queue rate | 21/156 | 13.5 % | 9.0–19.7 % |
| False-review rate | 11/117 | 9.4 % | 5.3–16.1 % |
| Needs-review recall | 10/10 | 100.0 % | 72.2–100.0 % |
| Review check matched | 10/10 | 100.0 % | 72.2–100.0 % |

Critical fields: 0 wrong, 12 missing, over 126 truth-quote cases.
Unsafe auto-accepts: none.
False reviews: eur-013, eur-015, forwarded-003, forwarded-008, hard-eur-quote-in-band, html-015, html-018, html-025, multi-grade-016, pdf-028, plain-020.
Truth needs_review but not sent to review: none.
Review expected but no listed check failed: none.

## Per-field accuracy

| Field | Critical | k/N | Rate | 95 % CI | Wrong | Missing |
|---|---|---:|---:|---:|---:|---:|
| vessel | yes | 126/126 | 100.0 % | 97.0–100.0 % | 0 | 0 |
| port | yes | 126/126 | 100.0 % | 97.0–100.0 % | 0 | 0 |
| supplier | no | 126/126 | 100.0 % | 97.0–100.0 % | 0 | 0 |
| currency | yes | 126/126 | 100.0 % | 97.0–100.0 % | 0 | 0 |
| validUntil | yes | 126/126 | 100.0 % | 97.0–100.0 % | 0 | 0 |
| deliveryFrom | yes | 116/126 | 92.1 % | 86.0–95.6 % | 0 | 10 |
| deliveryTo | yes | 124/126 | 98.4 % | 94.4–99.6 % | 0 | 2 |
| bargeFee | no | 125/126 | 99.2 % | 95.6–99.9 % | 0 | 1 |
| grade | yes | 142/142 | 100.0 % | 97.4–100.0 % | 0 | 0 |
| quantity | yes | 142/142 | 100.0 % | 97.4–100.0 % | 0 | 0 |
| price | yes | 142/142 | 100.0 % | 97.4–100.0 % | 0 | 0 |

## Error clusters (field misses, with case ids)

- deliveryFrom missing (10): eur-013, forwarded-003, forwarded-008, hard-dot-thousands-qty, hard-eur-quote-in-band, hard-spoofed-supplier-name, hard-volume-m3, multi-grade-016, pdf-028, plain-020
- deliveryTo missing (2): eur-015, hard-volume-m3
- bargeFee missing (1): html-025

## Errors (not graded, not wrong answers)

None.

## Graded failures (status failed; nothing extracted)

None.

## Latency and cost (first runs, errors included)

| | n | Mean | p90 | Target |
|---|---:|---:|---:|---:|
| Latency per email (ingest + processing) | 156 | 6.0 s | 8.0 s | 20.0 s |
| Model latency per email (llm_calls) | 156 | 6.0 s | 7.9 s | |
| Cost per email (llm_calls) | 156 | $0.000704 | $0.000976 | |

Total cost of every run, repeats included: $0.131250.

## Variance (hard cases repeated; not in the headline)

| Case | Truth | Runs | Statuses | Critical values agreed | All critical correct | Unsafe runs | Sent to review | Review check matched |
|---|---|---:|---|---|---|---:|---:|---:|
| hard-ambiguous-quantity | needs_review | 3 | needs_review, needs_review, needs_review | no | yes, yes, no | 0 | 3/3 | 3/3 |
| hard-barge-per-mt | extracted | 3 | extracted, extracted, extracted | yes | yes, yes, yes | 0 | - | - |
| hard-decimal-comma | needs_review | 3 | needs_review, needs_review, needs_review | yes | yes, yes, yes | 0 | 3/3 | 3/3 |
| hard-dot-thousands-qty | needs_review | 3 | needs_review, needs_review, needs_review | yes | no, no, no | 0 | 3/3 | 3/3 |
| hard-eur-quote-in-band | extracted | 3 | needs_review, extracted, extracted | no | no, yes, yes | 0 | - | - |
| hard-expired-validity | needs_review | 3 | needs_review, needs_review, needs_review | yes | yes, yes, yes | 0 | 3/3 | 3/3 |
| hard-missing-currency | needs_review | 3 | needs_review, needs_review, needs_review | yes | yes, yes, yes | 0 | 3/3 | 3/3 |
| hard-multi-grade-unrequired-grade | extracted | 3 | extracted, extracted, extracted | yes | yes, yes, yes | 0 | - | - |
| hard-pdf-image-only | needs_review | 3 | needs_review, needs_review, needs_review | yes | -, -, - | 0 | 3/3 | 3/3 |
| hard-price-typo-out-of-band | needs_review | 3 | needs_review, needs_review, needs_review | yes | yes, yes, yes | 0 | 3/3 | 3/3 |
| hard-qty-over-tank-capacity | needs_review | 3 | needs_review, needs_review, needs_review | yes | yes, yes, yes | 0 | 3/3 | 3/3 |
| hard-quote-in-html-only | extracted | 3 | extracted, extracted, extracted | yes | yes, yes, yes | 0 | - | - |
| hard-spoofed-supplier-name | needs_review | 3 | needs_review, needs_review, needs_review | yes | no, no, no | 0 | 3/3 | 3/3 |
| hard-volume-m3 | needs_review | 3 | needs_review, needs_review, needs_review | no | no, no, no | 0 | 3/3 | 3/3 |

Over every graded run of the repeated needs_review cases:

| Metric | k/N | Rate | 95 % CI (Wilson) |
|---|---:|---:|---:|
| Needs-review recall | 30/30 | 100.0 % | 88.6–100.0 % |
| Review check matched | 30/30 | 100.0 % | 88.6–100.0 % |

