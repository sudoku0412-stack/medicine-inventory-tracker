# Phase 2 handover

## Current state

- Product: Medicine Inventory Tracker, household-first responsive web app. Future iOS/Android clients and general store inventory are long-term goals.
- Repository: https://github.com/sudoku0412-stack/medicine-inventory-tracker (public), main branch.
- Phase 1 remains on main (implementation 1606a91, merge eb2e5c2).
- Phase 2 item 1 (blank Monthly cabinet check button) is implemented on branch `cursor/cabinet-check-button-65d1`.
- Stack: plain HTML/CSS/JavaScript, Node 26+ HTTP API, built-in SQLite. No third-party runtime dependencies. Run npm start; open http://127.0.0.1:3000. Run npm test.
- Local data: data/inventory.sqlite, excluded from Git. Do not overwrite user inventory.

## Delivered behavior and limits

- Manual batch creation/editing, quantity/unit and low-stock threshold, expiry/unknown expiry, location/notes, consume/discard, dashboard, search/status filters, responsive layouts, persistent in-app expiry reminders and read state.
- Expiry and reminder rules use date-only calendar arithmetic with a 30-day warning window. Same medicine may have multiple batches.
- Local single-user application, no authentication. Default bind is 127.0.0.1. Static assets use an explicit allowlist.
- Notifications are IN-APP ONLY. No email/push delivery or background external notification service is implemented.
- Tests cover persistence, validation/overdraw, edit/discard, date boundaries and reminder deduplication/read/stale cleanup.

## Phase 2 progress

1. **Done — Monthly cabinet check button.** Root cause: the control sat on the dark `.reminder-card` with inherited white text, so a white `.button.secondary` looked blank. Clicking it used `data-view`, which was easy to confuse with Home on mobile. Fix: `.button.light` plus explicit deep text/`-webkit-text-fill-color`, full-width placement on mid-size layouts, and `#reviewCabinetBtn` navigating to Inventory (all filter), not Dashboard.
2. **Not started — packaging photos / AI suggest name and expiry.** Still blocked on provider, credentials, cost controls, image retention, and date-handling decisions. Manual entry stays available when this is built.
3. **Not started — real expiry delivery (email or web push)** while the app is closed. No service credentials or deployment target selected.

Household sharing and commercial store features remain later phases. Preserve the approved UI unless the user requests changes.

## Working agreement

User asked this chat not to follow AGENTS.md specialist delegation. Continue from this file on the next session; do not re-fix item 1 unless a regression is found.
