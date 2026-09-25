# Deploy to https://medicineinventory.craftloop.ca (always on, no Mac, no tunnel)

This app runs on **Cloudflare Workers** with **D1** (inventory), **R2** (packaging photos), and **KV** (VAPID keys). Your phone opens the domain over HTTPS and can use **Take photo** for scanning.

Local `npm start` still works for development (SQLite in `data/`). Production data lives in Cloudflare, not on your laptop.

## Before you publish

1. **Cloudflare Access** on `medicineinventory.craftloop.ca` (Zero Trust → Access → self-hosted app). Allow only your household email. Without Access, anyone with the URL could edit your cabinet.
2. **Gemini key** as a Worker secret for packaging scan.

## One-time Cloudflare setup

1. Install Wrangler and log in:

```sh
npm install
npx wrangler login
```

2. Create resources (once):

```sh
npx wrangler d1 create medicine-inventory
npx wrangler r2 bucket create medicine-inventory-photos
npx wrangler kv namespace create medicine-inventory-kv
```

3. Copy the **D1 database id** and **KV namespace id** into `wrangler.toml` (replace placeholders if Wrangler did not fill them automatically).

4. Apply the schema:

```sh
npx wrangler d1 migrations apply medicine-inventory --remote
```

5. Set secrets:

```sh
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
```

Use your Access team URL (for example `https://<team>.cloudflareaccess.com`) and the application **Audience** tag from the Access app for this hostname.

6. Attach the custom domain in the Cloudflare dashboard if Wrangler has not already linked `medicineinventory.craftloop.ca`.

## Deploy

```sh
npm run deploy
```

Open **https://medicineinventory.craftloop.ca** on your phone, sign in with Access, then **Add medicine → Take photo**.

## What runs where

| Piece | Cloudflare | Your Mac |
| --- | --- | --- |
| HTML / CSS / JS | Worker assets (`public/`) | optional `npm start` for dev |
| Inventory API + SQLite logic | Worker + D1 | local SQLite when developing |
| Photos | R2 | `data/photos/` locally |
| Expiry push cron | Worker scheduled (every 15 min) | local timer when using `npm start` |
| Gemini scan | Worker → Google API | same when local |

## Local dev vs cloud

- **Local:** `npm start` → http://127.0.0.1:3000 (unchanged workflow).
- **Cloud:** `npm run deploy` → D1/R2/KV; does not copy your local `data/inventory.sqlite`. Export/import is manual if you need to migrate an existing cabinet later.

## Troubleshooting

- **401 Sign in through Cloudflare Access:** set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` secrets and complete Access login in the browser.
- **Vision false / no Gemini suggestions:** set `GEMINI_API_KEY` secret and redeploy.
- **Camera blocked:** use HTTPS URL (not IP), allow camera for the site in phone settings.
