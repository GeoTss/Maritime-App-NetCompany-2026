# Phase 6 screenshots

All captured from the live replay demo stack (http://localhost:5173, built app) at 2026-11-16T01:41Z, by a read-only Playwright script (navigation, focus and keyboard only; reducedMotion, scale 1). Stack state: two executed recommendations (voyage instruction, purchase order PO-000001), three inbox emails, nothing pending. Sim clock pinned 14 Nov 08:05Z. "Full" shots: viewport grown until no inner scroller overflows (no stitching).

- inbox-mobile.png: inbox list, nothing selected. 390x844.
- inbox-mobile-detail.png: Algeciras email open (?document=3), accepted with checks. 390x1257.
- assistant-mobile.png: assistant drawer from the top-bar toggle. 390x844. Caveat: dock conversation is empty (story's chat lives only in the story's browser session), so no answer or fact chips.
- map-mobile-default.png: map, nothing selected. 390x844.
- map-mobile-route.png: Aegean Pioneer panel (?vessel=1). 390x844. Caveat: no route tray; it needs a POST plan, panel says "once you plan a route".
- evaluation-full.png: evaluation page. 1440x1160. evaluation-mobile-full.png: 390x1696.
- focus-shell.png: 3 Tabs from load on /, sim clock focused with tooltip. 1440x900.
- focus-cmdk.png: command menu open via Ctrl+K on /. 1440x900.
- focus-dialog.png: /dev/kit dialog opened by keyboard (Enter on trigger); decides nothing. 1440x900.
- focus-inbox.png: inbox row focused by keyboard. 1440x900.
- approvals-final.png: /approvals decided state, full page. 1440x2290. approvals-final-mobile.png: 390x2973.
- approvals-queue.png, approvals-approved.png: /approvals current state, first fold. 1440x900. No pending card exists now.
- approvals-mobile.png: /approvals first fold. 390x844. Caveat: no pending card.
- approvals-approve-dialog.png: copy of focus-dialog.png (kit dialog); the real queue has no pending card to approve.
- map-default.png: map, nothing selected. 1440x900. map-vessel-panel.png: ?vessel=1. 1440x900.
- inbox-evidence.png: Kestrel quote, Supplier row focused/hovered, evidence highlighted in the email. 1440x900.
- inbox-review-form.png: Algeciras email (?document=3), accepted outcome. 1440x900.
- assistant-answer-chip.png: NOT recaptured (no conversation available); older mocked file left as is, stale.
