# Medicine Inventory Tracker architecture

This document is the durable technical map of the deployed system. It records decisions that are already in use and clearly separates them from planned work. Update it when an architectural decision is finalized or a planned design becomes deployed.

## Product boundary

Medicine Inventory Tracker is a responsive web application for managing medicine batches, expiry dates, stock levels, locations, reminders, and optional packaging photos. The product is protected by Cloudflare Access in production. User-facing language calls the shared space a **Shop**; existing database and API identifiers remain `household`-scoped for compatibility.

## Runtime layout

```text
Browser (plain HTML, CSS, JavaScript)
        |
        | HTTPS + Cloudflare Access session
        v
Cloudflare Worker
  |-- static assets from Workers Assets
  |-- API and scheduled push delivery
  |-- verifies Cloudflare Access JWT for production API calls
  |-- D1: inventory, users, memberships, settings, invitations, receipts
  |-- R2: packaging photos
  `-- KV: web-push configuration

Local development
  `-- Node HTTP server + SQLite + local photo files
```

## Clients and presentation

- Static client: `public/index.html`, `public/app.js`, `public/styles.css`; no client-side OAuth credentials are stored.
- The browser calls same-origin APIs with the Cloudflare Access session and renders server-authorized data only.
- Static HTML and bootstrap assets use fresh-cache policies so deploys do not leave an authenticated user on an old shell. Image assets use immutable caching.
- The app has responsive inventory, reminder, profile, access-management, invitation-acceptance, and sign-out flows. The sign-out action sends the user to Cloudflare Access’s same-origin logout endpoint.

## Identity and authorization

- Production endpoints validate a Cloudflare Access JWT signature, issuer, audience, and expiry. Browser-supplied identity, role, and email fields are never authority.
- A verified identity is bound to its provider and subject. Email may support invitation matching, but never account linking or ownership takeover.
- D1 stores `users`, `identities`, `households`, `memberships`, `household_settings`, and a permanent singleton bootstrap marker.
- Roles currently are `owner` and `member`. Owners manage invitations; members can use Shop inventory according to existing server checks.
- Invitations are addressed to a normalized verified email, expire after seven days, and grant membership only through explicit acceptance by the matching authenticated identity.
- Existing tables, routes, payload fields, DOM hooks, and migration names retain the internal `household` term. Do not rename them without a separately approved compatibility migration.

## Data and sync model

- Local mode is loopback-only and uses SQLite as a single-user Shop.
- Cloud mode uses D1 as the source of truth. Inventory and push data are tenant-scoped by internal household ID.
- Each cloud batch has a revision. Browser mutations carry an operation ID and base revision; duplicate operations replay safely and stale changes return a conflict for user review.
- No offline mutation queue, bidirectional change feed, background reconciliation, or cross-device conflict UI exists yet.
- Packaging images live in R2. Optional Gemini suggestions are server-side, require a configured secret, and are never saved until the user confirms the medicine form.

## Deployment and operations

- Production target: `https://medicineinventory.craftloop.ca`.
- The Worker configuration and deployment notes live in `deploy/cloudflare-workers.md`.
- D1 migrations are additive and applied before a Worker that depends on them. Verify the migration ledger and production route after every deployment.
- Secrets remain in Cloudflare/Wrangler or ignored local files. Never commit Access, Apple, Google, Gemini, VAPID, database, or photo credentials.
- `HANDOVER.md` records delivery and deployment checkpoints; `BUGFIX_PLAN.md` records the evidence-first triage process.

## Finalized design: Shop terminology

- UI, live-region, and returned error copy use **Shop**.
- Internal compatibility contracts intentionally remain household-scoped.
- No data migration was needed for the terminology release.

## Planned next: secure Shop administration onboarding

This is a design, not deployed behavior.

1. Keep the existing single-Shop model. The existing `owner` role is the administrator, presented as **Shop administration** in the UI.
2. Replace automatic first-request ownership with an explicit onboarding check and explicit setup action. Only a verified identity on the configured initial-owner allowlist may set up the first Shop when the singleton bootstrap marker is absent.
3. Once claimed, ownership binds to verified provider/subject. An uninvited user, another allowlisted address, or a matching email with another subject cannot take over the Shop.
4. Add an append-only access-audit migration for bootstrap, invitation creation, acceptance, and revocation. Record actor, Shop, target, timestamp, and request correlation ID; never store JWTs or secrets.
5. Start with Shop name, members/roles, pending invitations, invite, and revoke. Defer ownership transfer, admin promotion, member removal, account linking, and multi-Shop support.
6. Recheck owner authorization and same-origin protections on every administration mutation. Test concurrent setup, forged identity input, expired/revoked invitations, cross-Shop isolation, and audit rollback.

### Required decision before implementation

Choose the verified Cloudflare Access account authorized to establish the initial Shop owner. For strongest protection, configure the provider/subject after observing that account’s authenticated login, in addition to its email allowlist.

## Deferred architecture work

- Pull/change feed and offline synchronization reconciliation.
- Native mobile clients.
- Export, account deletion, configurable reminder windows, and broader multi-Shop sharing.
