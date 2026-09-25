# Medicine Inventory Tracker — handover

## Current state

- Product: household medicine inventory (responsive web). Long-term: optional native clients; not a commercial store product.
- Repository: https://github.com/sudoku0412-stack/medicine-inventory-tracker (public).
- **Production:** https://medicineinventory.craftloop.ca — Cloudflare Worker + D1 + R2 + KV, protected by **Cloudflare Access**. Deploy: `deploy/cloudflare-workers.md`, `npm run deploy`.
- **Local dev:** Node 26+, `npm start` → http://127.0.0.1:3000, SQLite under `data/`. Static UI in `public/`. Run `npm test`.
- **Secrets (never commit):** local `data/gemini.key`, `data/vapid.json`, `.env`; cloud Wrangler secrets (`GEMINI_API_KEY`, optional `ACCESS_*`).

## What is on `main` (merged)

| PR | Topic |
| --- | --- |
| Phase 1 (1606a91) | Dashboard, inventory, in-app expiry reminders |
| #1 | Monthly cabinet check button |
| #2 | Packaging photos + confirmed suggestions |
| #3 | Web push expiry alerts (service worker) |
| #4 | Gemini packaging scan |
| #5 | `app.js` parse fix + form `autocomplete` |
| #6 | Live camera for **Take photo** (Chrome / phone HTTPS) |
| #8 | Always-on Cloudflare deploy (Worker, D1, R2, KV) |

**Open PRs:** none (as of last check).

**Follow-up on `main` after #8:** pin D1/KV ids in `wrangler.toml`, R2 setup notes, trust Access edge header for API after login, `credentials` on API `fetch` — landed via handover branch / small PR if not yet merged.

## Delivered behavior

- Batches: name, strength, form, quantity, unit, low-stock threshold, expiry (or unknown), location, notes; consume / discard; status filters and search.
- Optional pack photos (JPEG/PNG/WebP, 2 MB). **Take photo** uses camera on HTTPS; **Upload photo** uses file picker. Gemini suggests name/expiry when `GEMINI_API_KEY` is set; saving the form is confirmation.
- In-app 30-day expiry reminders; optional **Enable expiry alerts** (web push). Cloud cron delivers push on Workers; local uses `npm start` timer.
- Expiry rules: date-only calendar math, 30-day warning window.

## Phase 2 — done

1. Monthly cabinet check button (PR #1).
2. Packaging photos + AI suggest + confirm (PR #2, #4, #6).
3. Expiry delivery when app closed — web push (PR #3).

## Phase 3 — done (deploy)

Always-on hosting at **medicineinventory.craftloop.ca** without a home Mac or tunnel: Worker API, D1 inventory, R2 photos, KV for VAPID, Access login, Gemini via secret.

**Not done:** automatic import from an existing local `data/inventory.sqlite` into D1.

## Phase 4 — Profile & settings

Profile & settings is a single, local-household screen. It persists a display name (1–60 characters), household name (1–80 characters), and default storage location in both SQLite and D1. The default applies only when creating a new medicine; existing rows are not rewritten. The API is `GET`/`PATCH /api/settings`; production requires D1 migration `0003_profile_settings.sql`.

This phase intentionally excludes authentication, household sharing, cloud data sync, exports/deletion, themes, and configurable reminder windows.

## Phase 5 — Identity and tenant foundation

Production API requests validate a signed Cloudflare Access JWT (signature, issuer, audience, and expiry); edge email headers are never accepted as identity. D1 now has tenant-scoped users, Access identities, households, memberships, household settings, and inventory/push records. One configured bootstrap owner atomically claims legacy rows. The migration and Worker deployment completed on 2026-09-25 (Worker version `4b2d9873-185f-4906-bf42-6cf92171369b`); `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `INITIAL_OWNER_EMAILS` are configured as production secrets. Local SQLite remains loopback-only and single-user.

**Next safe step:** sign in once through Cloudflare Access with a configured owner identity to claim the legacy household. Then implement owner-only invitations and household administration as a separate reviewed chunk. Apple and Google remain Cloudflare Access identity-provider configuration; no client-side OAuth secrets are stored in the repository.

## Working agreement

Do not launch Cursor cloud agents for this project. Read this file at the start of a new chat. Do not re-fix completed Phase 2 items unless a regression is found.
