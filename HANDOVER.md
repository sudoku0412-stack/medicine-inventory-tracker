# Phase 2 handover

## Current state

- Product: Medicine Inventory Tracker, household-first responsive web app.
- Repository: https://github.com/sudoku0412-stack/medicine-inventory-tracker (public).
- Phase 2 item 1 (cabinet check button) is on main (PR #1).
- Phase 2 item 2 (packaging photos / AI suggestions) is on `cursor/packaging-photo-suggest-94f5` (PR #2), not merged yet.
- Phase 2 item 3 (closed-app expiry alerts) is on `cursor/expiry-web-push-94f5`.
- Stack: plain HTML/CSS/JavaScript, Node 26+ HTTP API, built-in SQLite. No third-party runtime dependencies.
- Local data: `data/inventory.sqlite` and `data/vapid.json`, excluded from Git. Do not overwrite user inventory.

## Phase 2 progress

1. **Done — Monthly cabinet check button.** On main.
2. **Done (open PR) — packaging photos / AI suggest.** PR #2. Optional `VISION_API_KEY`; user confirmation required; photos stored after save.
3. **Done (this branch) — web push expiry alerts.** Local VAPID keys, Notifications → Enable expiry alerts, service worker, server delivery when a 30-day reminder is created and on a 15-minute timer. Requires `npm start` plus a browser subscription on localhost or HTTPS. Not email. Not a hosted push vendor account.

## Working agreement

Do not launch Cursor cloud agents for this project. Implement in this session only.
