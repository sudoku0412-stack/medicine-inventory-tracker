# Phase 2 handover

## Current state

- Product: Medicine Inventory Tracker, household-first responsive web app. Future iOS/Android clients and general store inventory are long-term goals.
- Repository: https://github.com/sudoku0412-stack/medicine-inventory-tracker (public).
- Phase 2 item 1 (cabinet check button) is on main (PR #1).
- Phase 2 item 2 (packaging photos) is on main (PR #2). Gemini scanning is this branch (PR #4).
- Phase 2 item 3 (web push expiry alerts) is on main (PR #3).
- Stack: plain HTML/CSS/JavaScript, Node 26+ HTTP API, built-in SQLite for local dev. Cloud production: Cloudflare Worker + D1 + R2 + KV (`deploy/cloudflare-workers.md`). Run `npm start` locally; `npm run deploy` for **medicineinventory.craftloop.ca**. Run `npm test`.
- Local data: `data/inventory.sqlite`, `data/photos/`, `data/vapid.json`, and `data/gemini.key`, excluded from Git. Do not overwrite user inventory.

## Delivered behavior and limits

- Manual batch creation/editing, quantity/unit and low-stock threshold, expiry/unknown expiry, location/notes, consume/discard, dashboard, search/status filters, responsive layouts, persistent in-app expiry reminders and read state.
- Optional packaging photos (JPEG/PNG/WebP, 2 MB, real image signatures). Take photo uses a live camera preview on localhost/HTTPS; Upload photo uses the file picker. Photos persist only after save and are removed on discard.
- AI name/expiry suggestions use Google Gemini (`gemini-flash-latest`) when `GEMINI_API_KEY` / `VISION_API_KEY` or gitignored `data/gemini.key` is present. One call per photo, 20s timeout. Invalid or incomplete dates stay blank. Saving the form is confirmation. Manual entry always remains. The key is not stored in Git.
- Web push expiry alerts: local VAPID keys, Notifications → Enable expiry alerts, service worker, server delivery when a 30-day reminder is created and on a 15-minute timer. Requires `npm start` plus a browser subscription on localhost or HTTPS. Not email.
- Expiry and reminder rules use date-only calendar arithmetic with a 30-day warning window.

## Phase 2 progress

1. **Done — Monthly cabinet check button.** On main.
2. **Done — packaging photos / AI suggest.** Photos on main; Gemini scanner on this PR.
3. **Done — web push expiry alerts.** On main (PR #3).

## Phase 3 progress

1. **In progress — always-on Cloudflare deploy.** Worker + D1 + R2 at `medicineinventory.craftloop.ca` (no tunnel, no Mac). Access + Gemini secrets required. See `deploy/cloudflare-workers.md`.
2. **Not started — migrate local SQLite cabinet into D1** (manual/export tooling if needed).

## Working agreement

Do not launch Cursor cloud agents for this project. Do not re-fix item 1 unless a regression is found.

## Greeting follow-up (2026-09-25)

- The dashboard greeting now derives from the browser's local hour: night (21:00–04:59), morning (05:00–11:59), afternoon (12:00–16:59), and evening (17:00–20:59). The displayed name remains unchanged.
- `public/greeting.js` keeps the time classification pure and explicit; regression coverage passes fixed local-hour values for every boundary, avoiding dependence on the test machine clock or timezone.
- The greeting module is included in the shared public-asset allowlist for both local and Worker serving. A Worker route-level regression test verifies `/greeting.js` reaches the asset binding.
