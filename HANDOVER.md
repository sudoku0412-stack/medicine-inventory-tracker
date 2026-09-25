# Phase 2 handover

## Current state

- Product: Medicine Inventory Tracker, household-first responsive web app. Future iOS/Android clients and general store inventory are long-term goals.
- Repository: https://github.com/sudoku0412-stack/medicine-inventory-tracker (public).
- Phase 1 is on main. Phase 2 item 1 (cabinet check button) is merged to main via PR #1.
- Phase 2 item 2 is on `cursor/packaging-photo-suggest-94f5` (PR #2): packaging photos plus optional vision suggestions that require user confirmation.
- Stack: plain HTML/CSS/JavaScript, Node 26+ HTTP API, built-in SQLite. No third-party runtime dependencies. Run npm start; open http://127.0.0.1:3000. Run npm test.
- Local data: `data/inventory.sqlite` and `data/photos/`, excluded from Git. Do not overwrite user inventory.

## Delivered behavior and limits

- Manual batch creation/editing, quantity/unit and low-stock threshold, expiry/unknown expiry, location/notes, consume/discard, dashboard, search/status filters, responsive layouts, persistent in-app expiry reminders and read state.
- Optional packaging photos (JPEG/PNG/WebP, 2 MB, real image signatures). Photos persist only after save and are removed on discard.
- AI name/expiry suggestions use Google Gemini (`gemini-flash-latest`) when `GEMINI_API_KEY` / `VISION_API_KEY` or gitignored `data/gemini.key` is present. One call per photo, 20s timeout. Invalid or incomplete dates stay blank. Saving the form is confirmation. Manual entry always remains. The key is not stored in Git.
- Expiry and reminder rules use date-only calendar arithmetic with a 30-day warning window. Same medicine may have multiple batches.
- Local single-user application, no authentication. Default bind is 127.0.0.1. Static assets use an explicit allowlist.
- Notifications are still IN-APP ONLY until item 3. No email/push delivery while the app is closed.
- Tests cover persistence, validation/overdraw, edit/discard, date boundaries, reminder deduplication/read/stale cleanup, suggestion parsing, photo storage, and mocked suggest HTTP.

## Phase 2 progress

1. **Done — Monthly cabinet check button.** Root cause: white inherited text on a white `.button.secondary` inside the dark reminder card. Fix is on main.
2. **Done — packaging photos / AI suggest name and expiry.** Gemini is the default scanner. Credentials stay in `data/gemini.key` or env, never the repo. User confirmation is still required.
3. **Not started — real expiry delivery (email or web push)** while the app is closed. No service credentials or deployment target selected.

Household sharing and commercial store features remain later phases. Preserve the approved UI unless the user requests changes.

## Working agreement

Do not launch Cursor cloud agents for this project; implement and review in this session. Do not re-fix item 1 unless a regression is found. Next: item 3, expiry alerts when the app is closed.
