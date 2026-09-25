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

2. **Enable R2** in the Cloudflare dashboard (same account as Workers): open **R2** in the left sidebar and accept setup (Workers Free includes a small R2 allowance; billing may ask for a payment method even if usage stays free). Error `10042` means R2 is not enabled yet.

3. Create resources (once):

```sh
npx wrangler d1 create medicine-inventory
npx wrangler r2 bucket create medicine-inventory-photos
npx wrangler kv namespace create medicine-inventory-kv
```

You already created D1 and KV. After R2 is enabled, run only:

```sh
npx wrangler r2 bucket create medicine-inventory-photos
```

4. Confirm `wrangler.toml` has your **D1 database_id** and **KV id** (this repo pins the ids from your account).

5. Apply the schema:

```sh
npx wrangler d1 migrations apply medicine-inventory --remote
```

6. Set secrets:

```sh
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
```

Use your Access team URL (for example `https://<team>.cloudflareaccess.com`) and the application **Audience** tag from the Access app for this hostname.

7. Attach the custom domain in the Cloudflare dashboard if Wrangler has not already linked `medicineinventory.craftloop.ca`.

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

- **401 Sign in through Cloudflare Access:** set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` secrets, or delete both secrets if Access already protects the hostname (the Worker trusts `Cf-Access-Authenticated-User-Email` from Zero Trust). Wrong `ACCESS_AUD` causes API 401 while the HTML still loads.
- **Unable to load inventory / empty dashboard:** run `npx wrangler d1 migrations apply medicine-inventory --remote`, then check DevTools → Network → `/api/batches` (401 = Access secrets; 500 = D1/migrations).
- **Vision false / no Gemini suggestions:** set `GEMINI_API_KEY` secret and redeploy.
- **R2 error 10042:** enable R2 in the Cloudflare dashboard first, then create the bucket again.
