# Phase 2 handover

## Current state

- Product: Medicine Inventory Tracker, household-first responsive web app. Future iOS/Android clients and general store inventory are long-term goals.
- Repository: https://github.com/sudoku0412-stack/medicine-inventory-tracker (public).
- Phase 2 item 1 (cabinet check button) is on main (PR #1).
- Phase 2 item 2 (packaging photos) is on main (PR #2). Gemini scanning is this branch (PR #4).
- Phase 2 item 3 (web push expiry alerts) is on main (PR #3).
- Stack: plain HTML/CSS/JavaScript, Node 26+ HTTP API, built-in SQLite. No third-party runtime dependencies. Run npm start; open http://127.0.0.1:3000. Run npm test. Phone/domain access is Cloudflare Tunnel + Access in front of that same process (`deploy/cloudflare.md`), not Pages/Workers.
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

1. **In progress — HTTPS domain + phone camera.** Tunnel/Access docs, example `cloudflared` config, optional `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` JWT check on the Node origin. Inventory stays in local SQLite. The Mac must keep Node and the tunnel running.
2. **Not started — always-on host.** Moving Node off a sleeping laptop.
3. **Not started — Cloudflare Pages/Workers rewrite.** Out of scope; D1/R2 would replace SQLite and photos.

## Working agreement

Do not launch Cursor cloud agents for this project. Do not re-fix item 1 unless a regression is found.
