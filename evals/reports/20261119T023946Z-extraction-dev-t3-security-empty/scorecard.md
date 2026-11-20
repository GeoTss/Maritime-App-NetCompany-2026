# Extraction scorecard: dev / t3-security-empty

- Mode: empty; extractor: empty; no model calls
- Prompt version: empty
- World: seed 20261114, anchor 2026-11-14T08:00:00.000Z
- Started 2026-11-19T02:39:46.286Z, finished 2026-11-19T02:39:47.778Z
- Cases: 114 selected, 114 run, 114 graded, 0 errors
- Served models: none (no model calls)
- Spend: llm_calls $0.000000; nothing ledgered (no live calls)

## Headline (first run of each case; errors excluded)

Fuel quotes and not-a-quote emails. The 30 Track 3 security quotes are scored in their own section below (quote and not-a-quote precision still count every email).

| Metric | k/N | Rate | 95 % CI (Wilson) |
|---|---:|---:|---:|
| Critical-field accuracy | 7/651 | 1.1 % | 0.5–2.2 % |
| Unsafe auto-accepts | 0/84 | 0.0 % | 0.0–4.4 % |
| Quote precision | 71/84 | 84.5 % | 75.3–90.7 % |
| Quote recall | 71/71 | 100.0 % | 94.9–100.0 % |
| Not-a-quote precision | 0/0 | - | - |
| Not-a-quote recall | 0/13 | 0.0 % | 0.0–22.8 % |
| Review-queue rate | 84/84 | 100.0 % | 95.6–100.0 % |
| False-review rate | 55/55 | 100.0 % | 93.5–100.0 % |
| Needs-review recall | 16/16 | 100.0 % | 80.6–100.0 % |
| Review check matched | 14/16 | 87.5 % | 64.0–96.5 % |

Critical fields: 0 wrong, 644 missing, over 70 truth-quote cases.
Unsafe auto-accepts: none.
False reviews: eur-002, eur-003, eur-012, eur-016, eur-018, eur-019, eur-021, forwarded-002, forwarded-006, forwarded-007, forwarded-011, forwarded-014, hard-barge-per-mt-v2, hard-eur-quote-in-band-v2, hard-injection-override, hard-injection-override-v2, hard-multi-grade-unrequired-grade-v2, hard-quote-in-html-only-v2, hard-thread-stale-revision, hard-thread-stale-revision-v2, html-001, html-002, html-007, html-017, html-019, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-004, multi-grade-005, multi-grade-009, multi-grade-019, pdf-009, pdf-010, pdf-012, pdf-014, pdf-018, pdf-019, pdf-022, pdf-027, pdf-030, plain-003, plain-007, plain-013, plain-014, plain-017, plain-018, plain-021, plain-027, plain-030, plain-036, plain-037.
Truth needs_review but not sent to review: none.
Review expected but no listed check failed: hard-qty-over-tank-capacity-v2, hard-spoofed-supplier-name-v2.

## Security quotes (Track 3; first runs, errors excluded)

| Metric | k/N | Rate | 95 % CI (Wilson) |
|---|---:|---:|---:|
| Security critical-field accuracy | 0/243 | 0.0 % | 0.0–1.6 % |
| Unsafe auto-accepts | 0/30 | 0.0 % | 0.0–11.4 % |
| Security-quote precision | 30/30 | 100.0 % | 88.6–100.0 % |
| Security-quote recall | 30/30 | 100.0 % | 88.6–100.0 % |
| Review-queue rate | 30/30 | 100.0 % | 88.6–100.0 % |
| False-review rate | 27/27 | 100.0 % | 87.5–100.0 % |
| Needs-review recall | 3/3 | 100.0 % | 43.9–100.0 % |
| Review check matched | 3/3 | 100.0 % | 43.9–100.0 % |

Security critical fields: 0 wrong, 243 missing, over 27 graded field sets (30 security cases; a needs_review truth sent to review has no stored record and no field grades).
Unsafe auto-accepts: none.
False reviews: security-hard-eur-day-rate-a, security-hard-forwarded-older-offer-b, security-hard-team-in-words-a, security-html-001, security-html-004, security-html-005, security-html-007, security-html-012, security-html-014, security-html-015, security-html-016, security-pdf-003, security-pdf-004, security-pdf-006, security-pdf-009, security-pdf-011, security-pdf-014, security-pdf-015, security-pdf-016, security-plain-001, security-plain-002, security-plain-003, security-plain-004, security-plain-007, security-plain-009, security-plain-014, security-plain-015.
Truth needs_review but not sent to review: none.
Review expected but no listed check failed: none.

| Security field | Critical | k/N | Rate | 95 % CI | Wrong | Missing |
|---|---|---:|---:|---:|---:|---:|
| provider | no | 0/27 | 0.0 % | 0.0–12.5 % | 0 | 27 |
| vessel | yes | 0/27 | 0.0 % | 0.0–12.5 % | 0 | 27 |
| embarkPort | yes | 0/27 | 0.0 % | 0.0–12.5 % | 0 | 27 |
| disembarkPort | yes | 0/27 | 0.0 % | 0.0–12.5 % | 0 | 27 |
| teamSize | yes | 0/27 | 0.0 % | 0.0–12.5 % | 0 | 27 |
| dayRate | yes | 0/27 | 0.0 % | 0.0–12.5 % | 0 | 27 |
| currency | yes | 0/27 | 0.0 % | 0.0–12.5 % | 0 | 27 |
| fixedFees | yes | 0/27 | 0.0 % | 0.0–12.5 % | 0 | 27 |
| minDays | yes | 0/27 | 0.0 % | 0.0–12.5 % | 0 | 27 |
| validUntil | yes | 0/27 | 0.0 % | 0.0–12.5 % | 0 | 27 |

Security error clusters (field misses, with case ids):

- provider missing (27): security-hard-eur-day-rate-a, security-hard-forwarded-older-offer-b, security-hard-team-in-words-a, security-html-001, security-html-004, security-html-005, security-html-007, security-html-012, security-html-014, security-html-015, security-html-016, security-pdf-003, security-pdf-004, security-pdf-006, security-pdf-009, security-pdf-011, security-pdf-014, security-pdf-015, security-pdf-016, security-plain-001, security-plain-002, security-plain-003, security-plain-004, security-plain-007, security-plain-009, security-plain-014, security-plain-015
- vessel missing (27): security-hard-eur-day-rate-a, security-hard-forwarded-older-offer-b, security-hard-team-in-words-a, security-html-001, security-html-004, security-html-005, security-html-007, security-html-012, security-html-014, security-html-015, security-html-016, security-pdf-003, security-pdf-004, security-pdf-006, security-pdf-009, security-pdf-011, security-pdf-014, security-pdf-015, security-pdf-016, security-plain-001, security-plain-002, security-plain-003, security-plain-004, security-plain-007, security-plain-009, security-plain-014, security-plain-015
- embarkPort missing (27): security-hard-eur-day-rate-a, security-hard-forwarded-older-offer-b, security-hard-team-in-words-a, security-html-001, security-html-004, security-html-005, security-html-007, security-html-012, security-html-014, security-html-015, security-html-016, security-pdf-003, security-pdf-004, security-pdf-006, security-pdf-009, security-pdf-011, security-pdf-014, security-pdf-015, security-pdf-016, security-plain-001, security-plain-002, security-plain-003, security-plain-004, security-plain-007, security-plain-009, security-plain-014, security-plain-015
- disembarkPort missing (27): security-hard-eur-day-rate-a, security-hard-forwarded-older-offer-b, security-hard-team-in-words-a, security-html-001, security-html-004, security-html-005, security-html-007, security-html-012, security-html-014, security-html-015, security-html-016, security-pdf-003, security-pdf-004, security-pdf-006, security-pdf-009, security-pdf-011, security-pdf-014, security-pdf-015, security-pdf-016, security-plain-001, security-plain-002, security-plain-003, security-plain-004, security-plain-007, security-plain-009, security-plain-014, security-plain-015
- teamSize missing (27): security-hard-eur-day-rate-a, security-hard-forwarded-older-offer-b, security-hard-team-in-words-a, security-html-001, security-html-004, security-html-005, security-html-007, security-html-012, security-html-014, security-html-015, security-html-016, security-pdf-003, security-pdf-004, security-pdf-006, security-pdf-009, security-pdf-011, security-pdf-014, security-pdf-015, security-pdf-016, security-plain-001, security-plain-002, security-plain-003, security-plain-004, security-plain-007, security-plain-009, security-plain-014, security-plain-015
- dayRate missing (27): security-hard-eur-day-rate-a, security-hard-forwarded-older-offer-b, security-hard-team-in-words-a, security-html-001, security-html-004, security-html-005, security-html-007, security-html-012, security-html-014, security-html-015, security-html-016, security-pdf-003, security-pdf-004, security-pdf-006, security-pdf-009, security-pdf-011, security-pdf-014, security-pdf-015, security-pdf-016, security-plain-001, security-plain-002, security-plain-003, security-plain-004, security-plain-007, security-plain-009, security-plain-014, security-plain-015
- currency missing (27): security-hard-eur-day-rate-a, security-hard-forwarded-older-offer-b, security-hard-team-in-words-a, security-html-001, security-html-004, security-html-005, security-html-007, security-html-012, security-html-014, security-html-015, security-html-016, security-pdf-003, security-pdf-004, security-pdf-006, security-pdf-009, security-pdf-011, security-pdf-014, security-pdf-015, security-pdf-016, security-plain-001, security-plain-002, security-plain-003, security-plain-004, security-plain-007, security-plain-009, security-plain-014, security-plain-015
- fixedFees missing (27): security-hard-eur-day-rate-a, security-hard-forwarded-older-offer-b, security-hard-team-in-words-a, security-html-001, security-html-004, security-html-005, security-html-007, security-html-012, security-html-014, security-html-015, security-html-016, security-pdf-003, security-pdf-004, security-pdf-006, security-pdf-009, security-pdf-011, security-pdf-014, security-pdf-015, security-pdf-016, security-plain-001, security-plain-002, security-plain-003, security-plain-004, security-plain-007, security-plain-009, security-plain-014, security-plain-015
- minDays missing (27): security-hard-eur-day-rate-a, security-hard-forwarded-older-offer-b, security-hard-team-in-words-a, security-html-001, security-html-004, security-html-005, security-html-007, security-html-012, security-html-014, security-html-015, security-html-016, security-pdf-003, security-pdf-004, security-pdf-006, security-pdf-009, security-pdf-011, security-pdf-014, security-pdf-015, security-pdf-016, security-plain-001, security-plain-002, security-plain-003, security-plain-004, security-plain-007, security-plain-009, security-plain-014, security-plain-015
- validUntil missing (27): security-hard-eur-day-rate-a, security-hard-forwarded-older-offer-b, security-hard-team-in-words-a, security-html-001, security-html-004, security-html-005, security-html-007, security-html-012, security-html-014, security-html-015, security-html-016, security-pdf-003, security-pdf-004, security-pdf-006, security-pdf-009, security-pdf-011, security-pdf-014, security-pdf-015, security-pdf-016, security-plain-001, security-plain-002, security-plain-003, security-plain-004, security-plain-007, security-plain-009, security-plain-014, security-plain-015

Cost per security email (llm_calls): mean $0.000000, p90 $0.000000.

## Per-field accuracy

| Field | Critical | k/N | Rate | 95 % CI | Wrong | Missing |
|---|---|---:|---:|---:|---:|---:|
| vessel | yes | 2/70 | 2.9 % | 0.8–9.8 % | 0 | 68 |
| port | yes | 0/70 | 0.0 % | 0.0–5.2 % | 0 | 70 |
| supplier | no | 70/70 | 100.0 % | 94.8–100.0 % | 0 | 0 |
| currency | yes | 1/70 | 1.4 % | 0.3–7.7 % | 0 | 69 |
| validUntil | yes | 0/70 | 0.0 % | 0.0–5.2 % | 0 | 70 |
| deliveryFrom | yes | 0/70 | 0.0 % | 0.0–5.2 % | 0 | 70 |
| deliveryTo | yes | 0/70 | 0.0 % | 0.0–5.2 % | 0 | 70 |
| bargeFee | no | 12/70 | 17.1 % | 10.1–27.6 % | 58 | 0 |
| grade | yes | 0/77 | 0.0 % | 0.0–4.8 % | 0 | 77 |
| quantity | yes | 3/77 | 3.9 % | 1.3–10.8 % | 0 | 74 |
| price | yes | 1/77 | 1.3 % | 0.2–7.0 % | 0 | 76 |

## Error clusters (field misses, with case ids)

- port missing (70): eur-002, eur-003, eur-012, eur-016, eur-018, eur-019, eur-021, forwarded-002, forwarded-006, forwarded-007, forwarded-011, forwarded-014, hard-ambiguous-quantity-v2, hard-barge-per-mt-v2, hard-decimal-comma-v2, hard-delivery-window-before-received, hard-delivery-window-before-received-v2, hard-dot-thousands-qty-v2, hard-eur-quote-in-band-v2, hard-expired-validity-v2, hard-forwarded-twice, hard-forwarded-twice-v2, hard-injection-override, hard-injection-override-v2, hard-missing-currency-v2, hard-multi-grade-unrequired-grade-v2, hard-price-typo-out-of-band-v2, hard-qty-over-tank-capacity-v2, hard-quote-in-html-only-v2, hard-spoofed-supplier-name-v2, hard-thread-stale-revision, hard-thread-stale-revision-v2, hard-unknown-vessel, hard-unknown-vessel-v2, hard-volume-m3-v2, html-001, html-002, html-007, html-017, html-019, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-004, multi-grade-005, multi-grade-009, multi-grade-019, pdf-009, pdf-010, pdf-012, pdf-014, pdf-018, pdf-019, pdf-022, pdf-027, pdf-030, plain-003, plain-007, plain-013, plain-014, plain-017, plain-018, plain-021, plain-027, plain-030, plain-036, plain-037
- validUntil missing (70): eur-002, eur-003, eur-012, eur-016, eur-018, eur-019, eur-021, forwarded-002, forwarded-006, forwarded-007, forwarded-011, forwarded-014, hard-ambiguous-quantity-v2, hard-barge-per-mt-v2, hard-decimal-comma-v2, hard-delivery-window-before-received, hard-delivery-window-before-received-v2, hard-dot-thousands-qty-v2, hard-eur-quote-in-band-v2, hard-expired-validity-v2, hard-forwarded-twice, hard-forwarded-twice-v2, hard-injection-override, hard-injection-override-v2, hard-missing-currency-v2, hard-multi-grade-unrequired-grade-v2, hard-price-typo-out-of-band-v2, hard-qty-over-tank-capacity-v2, hard-quote-in-html-only-v2, hard-spoofed-supplier-name-v2, hard-thread-stale-revision, hard-thread-stale-revision-v2, hard-unknown-vessel, hard-unknown-vessel-v2, hard-volume-m3-v2, html-001, html-002, html-007, html-017, html-019, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-004, multi-grade-005, multi-grade-009, multi-grade-019, pdf-009, pdf-010, pdf-012, pdf-014, pdf-018, pdf-019, pdf-022, pdf-027, pdf-030, plain-003, plain-007, plain-013, plain-014, plain-017, plain-018, plain-021, plain-027, plain-030, plain-036, plain-037
- deliveryFrom missing (70): eur-002, eur-003, eur-012, eur-016, eur-018, eur-019, eur-021, forwarded-002, forwarded-006, forwarded-007, forwarded-011, forwarded-014, hard-ambiguous-quantity-v2, hard-barge-per-mt-v2, hard-decimal-comma-v2, hard-delivery-window-before-received, hard-delivery-window-before-received-v2, hard-dot-thousands-qty-v2, hard-eur-quote-in-band-v2, hard-expired-validity-v2, hard-forwarded-twice, hard-forwarded-twice-v2, hard-injection-override, hard-injection-override-v2, hard-missing-currency-v2, hard-multi-grade-unrequired-grade-v2, hard-price-typo-out-of-band-v2, hard-qty-over-tank-capacity-v2, hard-quote-in-html-only-v2, hard-spoofed-supplier-name-v2, hard-thread-stale-revision, hard-thread-stale-revision-v2, hard-unknown-vessel, hard-unknown-vessel-v2, hard-volume-m3-v2, html-001, html-002, html-007, html-017, html-019, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-004, multi-grade-005, multi-grade-009, multi-grade-019, pdf-009, pdf-010, pdf-012, pdf-014, pdf-018, pdf-019, pdf-022, pdf-027, pdf-030, plain-003, plain-007, plain-013, plain-014, plain-017, plain-018, plain-021, plain-027, plain-030, plain-036, plain-037
- deliveryTo missing (70): eur-002, eur-003, eur-012, eur-016, eur-018, eur-019, eur-021, forwarded-002, forwarded-006, forwarded-007, forwarded-011, forwarded-014, hard-ambiguous-quantity-v2, hard-barge-per-mt-v2, hard-decimal-comma-v2, hard-delivery-window-before-received, hard-delivery-window-before-received-v2, hard-dot-thousands-qty-v2, hard-eur-quote-in-band-v2, hard-expired-validity-v2, hard-forwarded-twice, hard-forwarded-twice-v2, hard-injection-override, hard-injection-override-v2, hard-missing-currency-v2, hard-multi-grade-unrequired-grade-v2, hard-price-typo-out-of-band-v2, hard-qty-over-tank-capacity-v2, hard-quote-in-html-only-v2, hard-spoofed-supplier-name-v2, hard-thread-stale-revision, hard-thread-stale-revision-v2, hard-unknown-vessel, hard-unknown-vessel-v2, hard-volume-m3-v2, html-001, html-002, html-007, html-017, html-019, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-004, multi-grade-005, multi-grade-009, multi-grade-019, pdf-009, pdf-010, pdf-012, pdf-014, pdf-018, pdf-019, pdf-022, pdf-027, pdf-030, plain-003, plain-007, plain-013, plain-014, plain-017, plain-018, plain-021, plain-027, plain-030, plain-036, plain-037
- grade missing (70): eur-002, eur-003, eur-012, eur-016, eur-018, eur-019, eur-021, forwarded-002, forwarded-006, forwarded-007, forwarded-011, forwarded-014, hard-ambiguous-quantity-v2, hard-barge-per-mt-v2, hard-decimal-comma-v2, hard-delivery-window-before-received, hard-delivery-window-before-received-v2, hard-dot-thousands-qty-v2, hard-eur-quote-in-band-v2, hard-expired-validity-v2, hard-forwarded-twice, hard-forwarded-twice-v2, hard-injection-override, hard-injection-override-v2, hard-missing-currency-v2, hard-multi-grade-unrequired-grade-v2, hard-price-typo-out-of-band-v2, hard-qty-over-tank-capacity-v2, hard-quote-in-html-only-v2, hard-spoofed-supplier-name-v2, hard-thread-stale-revision, hard-thread-stale-revision-v2, hard-unknown-vessel, hard-unknown-vessel-v2, hard-volume-m3-v2, html-001, html-002, html-007, html-017, html-019, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-004, multi-grade-005, multi-grade-009, multi-grade-019, pdf-009, pdf-010, pdf-012, pdf-014, pdf-018, pdf-019, pdf-022, pdf-027, pdf-030, plain-003, plain-007, plain-013, plain-014, plain-017, plain-018, plain-021, plain-027, plain-030, plain-036, plain-037
- currency missing (69): eur-002, eur-003, eur-012, eur-016, eur-018, eur-019, eur-021, forwarded-002, forwarded-006, forwarded-007, forwarded-011, forwarded-014, hard-ambiguous-quantity-v2, hard-barge-per-mt-v2, hard-decimal-comma-v2, hard-delivery-window-before-received, hard-delivery-window-before-received-v2, hard-dot-thousands-qty-v2, hard-eur-quote-in-band-v2, hard-expired-validity-v2, hard-forwarded-twice, hard-forwarded-twice-v2, hard-injection-override, hard-injection-override-v2, hard-multi-grade-unrequired-grade-v2, hard-price-typo-out-of-band-v2, hard-qty-over-tank-capacity-v2, hard-quote-in-html-only-v2, hard-spoofed-supplier-name-v2, hard-thread-stale-revision, hard-thread-stale-revision-v2, hard-unknown-vessel, hard-unknown-vessel-v2, hard-volume-m3-v2, html-001, html-002, html-007, html-017, html-019, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-004, multi-grade-005, multi-grade-009, multi-grade-019, pdf-009, pdf-010, pdf-012, pdf-014, pdf-018, pdf-019, pdf-022, pdf-027, pdf-030, plain-003, plain-007, plain-013, plain-014, plain-017, plain-018, plain-021, plain-027, plain-030, plain-036, plain-037
- price missing (69): eur-002, eur-003, eur-012, eur-016, eur-018, eur-019, eur-021, forwarded-002, forwarded-006, forwarded-007, forwarded-011, forwarded-014, hard-ambiguous-quantity-v2, hard-barge-per-mt-v2, hard-delivery-window-before-received, hard-delivery-window-before-received-v2, hard-dot-thousands-qty-v2, hard-eur-quote-in-band-v2, hard-expired-validity-v2, hard-forwarded-twice, hard-forwarded-twice-v2, hard-injection-override, hard-injection-override-v2, hard-missing-currency-v2, hard-multi-grade-unrequired-grade-v2, hard-price-typo-out-of-band-v2, hard-qty-over-tank-capacity-v2, hard-quote-in-html-only-v2, hard-spoofed-supplier-name-v2, hard-thread-stale-revision, hard-thread-stale-revision-v2, hard-unknown-vessel, hard-unknown-vessel-v2, hard-volume-m3-v2, html-001, html-002, html-007, html-017, html-019, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-004, multi-grade-005, multi-grade-009, multi-grade-019, pdf-009, pdf-010, pdf-012, pdf-014, pdf-018, pdf-019, pdf-022, pdf-027, pdf-030, plain-003, plain-007, plain-013, plain-014, plain-017, plain-018, plain-021, plain-027, plain-030, plain-036, plain-037
- vessel missing (68): eur-002, eur-003, eur-012, eur-016, eur-018, eur-019, eur-021, forwarded-002, forwarded-006, forwarded-007, forwarded-011, forwarded-014, hard-ambiguous-quantity-v2, hard-barge-per-mt-v2, hard-decimal-comma-v2, hard-delivery-window-before-received, hard-delivery-window-before-received-v2, hard-dot-thousands-qty-v2, hard-eur-quote-in-band-v2, hard-expired-validity-v2, hard-forwarded-twice, hard-forwarded-twice-v2, hard-injection-override, hard-injection-override-v2, hard-missing-currency-v2, hard-multi-grade-unrequired-grade-v2, hard-price-typo-out-of-band-v2, hard-qty-over-tank-capacity-v2, hard-quote-in-html-only-v2, hard-spoofed-supplier-name-v2, hard-thread-stale-revision, hard-thread-stale-revision-v2, hard-volume-m3-v2, html-001, html-002, html-007, html-017, html-019, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-004, multi-grade-005, multi-grade-009, multi-grade-019, pdf-009, pdf-010, pdf-012, pdf-014, pdf-018, pdf-019, pdf-022, pdf-027, pdf-030, plain-003, plain-007, plain-013, plain-014, plain-017, plain-018, plain-021, plain-027, plain-030, plain-036, plain-037
- quantity missing (67): eur-002, eur-003, eur-012, eur-016, eur-018, eur-019, eur-021, forwarded-002, forwarded-006, forwarded-007, forwarded-011, forwarded-014, hard-barge-per-mt-v2, hard-decimal-comma-v2, hard-delivery-window-before-received, hard-delivery-window-before-received-v2, hard-eur-quote-in-band-v2, hard-expired-validity-v2, hard-forwarded-twice, hard-forwarded-twice-v2, hard-injection-override, hard-injection-override-v2, hard-missing-currency-v2, hard-multi-grade-unrequired-grade-v2, hard-price-typo-out-of-band-v2, hard-qty-over-tank-capacity-v2, hard-quote-in-html-only-v2, hard-spoofed-supplier-name-v2, hard-thread-stale-revision, hard-thread-stale-revision-v2, hard-unknown-vessel, hard-unknown-vessel-v2, html-001, html-002, html-007, html-017, html-019, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-004, multi-grade-005, multi-grade-009, multi-grade-019, pdf-009, pdf-010, pdf-012, pdf-014, pdf-018, pdf-019, pdf-022, pdf-027, pdf-030, plain-003, plain-007, plain-013, plain-014, plain-017, plain-018, plain-021, plain-027, plain-030, plain-036, plain-037
- bargeFee wrong (58): eur-002, eur-016, eur-019, forwarded-002, forwarded-006, forwarded-007, forwarded-011, forwarded-014, hard-ambiguous-quantity-v2, hard-barge-per-mt-v2, hard-decimal-comma-v2, hard-delivery-window-before-received, hard-delivery-window-before-received-v2, hard-eur-quote-in-band-v2, hard-forwarded-twice, hard-forwarded-twice-v2, hard-injection-override, hard-injection-override-v2, hard-multi-grade-unrequired-grade-v2, hard-price-typo-out-of-band-v2, hard-qty-over-tank-capacity-v2, hard-quote-in-html-only-v2, hard-spoofed-supplier-name-v2, hard-thread-stale-revision, hard-thread-stale-revision-v2, hard-unknown-vessel, hard-unknown-vessel-v2, hard-volume-m3-v2, html-002, html-017, html-019, html-020, html-022, html-023, html-024, multi-grade-002, multi-grade-003, multi-grade-004, multi-grade-005, multi-grade-009, pdf-009, pdf-010, pdf-012, pdf-014, pdf-018, pdf-019, pdf-022, pdf-027, pdf-030, plain-003, plain-007, plain-013, plain-014, plain-021, plain-027, plain-030, plain-036, plain-037

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

