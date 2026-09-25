# Phase 2 handover

## Current state

- Product: Medicine Inventory Tracker, household-first responsive web app. Future iOS/Android clients and general store inventory are long-term goals.
- Repository: https://github.com/sudoku0412-stack/medicine-inventory-tracker (public).
- Phase 2 item 1 (cabinet check button) is on main (PR #1).
- Phase 2 item 2 (packaging photos / AI suggestions) is on main (PR #2).
- Phase 2 item 3 (closed-app expiry alerts) is on `cursor/expiry-web-push-94f5` (PR #3), now rebased onto photos-on-main.
- A follow-up Gemini scanner change is on `cursor/gemini-packaging-scan-94f5` (PR #4) and is not in this merge.
- Stack: plain HTML/CSS/JavaScript, Node 26+ HTTP API, built-in SQLite. No third-party runtime dependencies. Run npm start; open http://127.0.0.1:3000. Run npm test.
- Local data: `data/inventory.sqlite`, `data/photos/`, and `data/vapid.json`, excluded from Git. Do not overwrite user inventory.

## Delivered behavior and limits

- Manual batch creation/editing, quantity/unit and low-stock threshold, expiry/unknown expiry, location/notes, consume/discard, dashboard, search/status filters, responsive layouts, persistent in-app expiry reminders and read state.
- Optional packaging photos (JPEG/PNG/WebP, 2 MB, real image signatures). Photos persist only after save and are removed on discard.
- AI name/expiry suggestions run when `VISION_API_KEY` is set on this branch (OpenAI-compatible). Saving the form is confirmation. Manual entry always remains.
- Web push expiry alerts: local VAPID keys, Notifications → Enable expiry alerts, service worker, server delivery when a 30-day reminder is created and on a 15-minute timer. Requires `npm start` plus a browser subscription on localhost or HTTPS. Not email.
- Expiry and reminder rules use date-only calendar arithmetic with a 30-day warning window.

## Phase 2 progress

1. **Done — Monthly cabinet check button.** On main.
2. **Done — packaging photos / AI suggest name and expiry.** On main (PR #2). Gemini key wiring is a separate open PR (#4).
3. **Done (this branch) — web push expiry alerts.** Merged with photos-on-main.

## Working agreement

Do not launch Cursor cloud agents for this project. Do not re-fix item 1 unless a regression is found.
