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

## Phase 5 — Identity, tenant foundation, and household administration

Production API requests validate a signed Cloudflare Access JWT (signature, issuer, audience, and expiry); edge email headers are never accepted as identity. D1 now has tenant-scoped users, Access identities, households, memberships, household settings, and inventory/push records. One configured bootstrap owner atomically claims legacy rows. The migration and Worker deployment completed on 2026-09-25 (Worker version `4b2d9873-185f-4906-bf42-6cf92171369b`); `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `INITIAL_OWNER_EMAILS` are configured as production secrets. Local SQLite remains loopback-only and single-user.

Owner-only household administration is now implemented for Cloudflare/D1: `GET /api/household/access`, `POST /api/household/invitations`, and `DELETE /api/household/invitations/:id`. Migration `0005_household_invitations.sql` stores normalized, pending member invitations only; it never grants membership. Local SQLite remains a single-household workflow and explains that cloud access is required. The Profile UI isolates invitation loading/errors from medicine data, and hides roster controls from non-owners.

Migration `0005_household_invitations.sql` was applied to production D1 and the reviewed Worker was deployed on 2026-09-25 as version `00a374f7-f760-462d-b46d-02df92b06416`; a follow-up migration check reports no pending migrations. **Next safe step:** test the owner flow in Cloudflare Access. A future, separately designed chunk may add invitation acceptance after it verifies the signed-in provider-and-subject identity. Do not add automatic enrollment, resends, role changes, or member removal to this chunk. Apple and Google remain Cloudflare Access identity-provider configuration; no client-side OAuth secrets are stored in the repository.

## Phase 6 — invitation acceptance (deployed 2026-09-25)

- PR #15 (`3dcf9ce`, “Add secure household invitation acceptance”) is merged on `origin/main`. Production D1 migration `0006_household_invitation_expiration.sql` was the only pending migration, was applied successfully, and the final ledger contains 0001, 0003, 0004, 0005, and 0006 with no pending migrations.
- `GET /api/household/invitations/pending` and explicit `POST /api/household/invitations/:id/accept` authenticate a Cloudflare Access JWT before (and independently of) tenant resolution. Pending returns unexpired matching invitations plus a membership boolean solely so an existing member is never gated by an unrelated invite. Acceptance binds only the verified provider, subject, and normalized signed email; it never accepts an email, household, or role from the client.
- Acceptance uses one D1 batch transaction with matching invitation predicates on every write. It consumes the invitation only after membership exists; identity uniqueness conflicts roll the whole batch back. Existing identities without memberships are reused; any existing membership is a 409 conflict. Bootstrap/legacy ownership is never invoked by these routes.
- The browser gates cloud identities before loading normal inventory UI. It offers an accessible, explicit Accept action and terminal/retry states; local server behavior stays unchanged.
- The Worker was deployed with `npm run deploy` as version `b882eeab-edc1-49bc-b245-e51e74e19df9`; no Access or DNS configuration was changed. A safe unauthenticated `HEAD`-equivalent HTTPS header check returned `302` from `https://medicineinventory.craftloop.ca/` to the Cloudflare Access login. Next step: test invitation acceptance end-to-end with an authenticated invited account.

## Working agreement

Do not launch Cursor cloud agents for this project. Read this file at the start of a new chat. Do not re-fix completed Phase 2 items unless a regression is found.

## Cache-policy checkpoint (2026-09-25)

- Diagnosis: the Worker forwarded `ASSETS.fetch()` responses without overriding cache headers, allowing Safari/edge to retain an old authenticated shell or bootstrap bundle after deployment.
- Fix: `worker/index.js` applies `no-store` to `/index.html`, `no-cache, must-revalidate` to `/app.js`, `/styles.css`, and `/sw.js`, and immutable caching to image assets. API routing is unchanged.
- Tests: added `test/worker-assets.test.js` for shell/bootstrap policies and the asset response path. No commit, push, or PR was created in this delegated worktree.
- Follow-up diagnosis: `.invite-gate { display: grid; }` overrode the browser’s `[hidden]` rule, so `showApp()` could not hide the invitation gate. Added `.invite-gate[hidden] { display: none; }` and a regression assertion.
- Living bug process: see `BUGFIX_PLAN.md` for the evidence-first triage checklist, incident log template, communication expectations, and the invitation overlay incident record.

## Production deployment follow-up (2026-09-25)

- PR #17 (`6cad65f8424940b56566155adf018e002453acf2`) was verified merged into `main`.
- Redeployed the merged Worker with the existing Wrangler configuration to `medicineinventory.craftloop.ca`.
- Remote D1 migration status reported **no migrations to apply**; no migration was run.
- Cloudflare deployment version: `765ec7f5-94dc-452c-a925-f4b8abdb3b3c`.
- Unauthenticated HTTPS check returned the expected Cloudflare Access `302` redirect to the Access login endpoint. No Access or DNS settings were changed.

## Sign-out follow-up (2026-09-25)

- Profile & settings now includes an accessible **Sign out** link to the same-origin Cloudflare Access endpoint `/cdn-cgi/access/logout`. It does not add an application-side session or change Access/DNS configuration.
- This ends the user's Cloudflare Access session, which Cloudflare documents as applying across Access-protected applications. Verify on the deployed custom domain after merge.

## Online inventory sync foundation (implementation pending review)

- First data-sync slice only: D1 remains the server source of truth, and every cloud batch now has an integer `revision`. Browser create, edit, consume, and discard requests include a UUID `operationId` plus `baseRevision`; local SQLite continues to accept the extra fields without adding an offline queue.
- Additive production migration: `0007_sync_mutation_foundation.sql`. It adds `batches.revision` (default `1` for existing records) and tenant-scoped `mutation_receipts`. A replay of the same operation ID returns the recorded result without applying the change again. A stale revision returns `409` with the current batch, and the UI reloads that batch and asks the user to review and retry.
- Focused tests cover the migration schema/default, idempotent create/update replay, stale conflict with the current revision, and same operation IDs isolated between households. Full suite: `npm test` — 42 passing.
- Retry safety follow-up: each browser action retains its operation ID and base revision through an ambiguous network failure, timeout/rate limit, or server error. It clears only after success, a definitive client/validation error (including a 409 conflict), or an explicit new action. This prevents a retry from duplicating a create, consume, or discard. A concurrent duplicate create that had already uploaded a separate photo now removes the losing R2 object after replaying the receipt.
- This slice deliberately does **not** add IndexedDB, an offline mutation queue, a change feed, merge UI, background reconciliation, auth changes, notifications, or photo-sync redesign. The next safe step, after production migration and verification, is a separately scoped pull/change feed design.
- Operational note: operation receipts are retained indefinitely in this first slice; establish a retention policy before high-volume sync usage.

## Production deployment follow-up (2026-09-25)

- PR #19 (`e50bc03`) is merged to `main` and deployed to `medicineinventory.craftloop.ca`.
- Cloudflare Worker version: `fbcecb56-1043-445f-bd29-a83680165c6c`.
- D1 migration check reported **No migrations to apply**; no migrations were run.
- Unauthenticated custom-domain verification returned HTTP 302 to the Cloudflare Access login endpoint. No Access or DNS configuration was changed.
- Browser sign-out was not exercised because it requires a real authenticated user session.

## Greeting follow-up (2026-09-26)

- The dashboard greeting now derives from the browser's local hour: night (21:00–04:59), morning (05:00–11:59), afternoon (12:00–16:59), and evening (17:00–20:59).
- `public/greeting.js` keeps the time classification pure and explicit; fixed-hour regression coverage avoids dependence on the test machine clock or timezone.
- The greeting helper is included in the shared public-asset allowlist and has a Worker route regression test.
