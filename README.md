# Medicine Inventory Tracker

A responsive, single-user household medicine inventory application. It keeps medicine batches in a local SQLite database, calculates expiry and low-stock status, and shows persistent 30-day in-app expiry reminders.

## Run

Requires Node.js 26 or later. No package installation is needed.

```sh
npm start
```

Open `http://127.0.0.1:3000`. Set `PORT` to change the port. The server binds to loopback by default; set `HOST` only for an intentional trusted-network deployment.

## Test

```sh
npm test
```

## Storage and deployment

The SQLite database is created at `data/inventory.sqlite`; it is deliberately excluded from Git. Packaging photos are stored under `data/photos/`. VAPID keys for web push are stored at `data/vapid.json`. Both are excluded. This application is designed for one local household, has no authentication, and must not be exposed publicly.

Binding `HOST` to a non-loopback address exposes an unauthenticated application and is unsafe unless access controls are provided externally.

## Profile and household settings

Profile & settings stores one local household profile: display name, household name, and the default storage location for new medicine batches. The defaults are **Kaushik**, **Kaushik’s home**, and **Medicine cabinet**. Settings are stored alongside the inventory in SQLite locally and in D1 in production; updating them never changes existing medicine records. On Cloudflare, apply the D1 migrations before deploying the Worker.

## Packaging photos

Add or edit a batch with an optional JPEG, PNG, or WebP photo (2 MB max). Take photo opens the device camera in the browser on localhost or HTTPS (Chrome will ask for permission). Desktop Chrome does not open the camera from a file-picker `capture` attribute, so this uses a live preview instead. Upload photo still uses the file picker. The photo is kept only after you save the batch. Manual name, quantity, and expiry entry always remain available.

If `GEMINI_API_KEY` or `VISION_API_KEY` is set, or `data/gemini.key` exists, one Gemini vision request can suggest a medicine name and a complete `YYYY-MM-DD` expiry. Incomplete or unreadable dates are left blank so you type them. Suggestions never create a batch on their own; saving the form is the confirmation step.

Put the Gemini key in `data/gemini.key` (gitignored) or in the environment. Do not commit the key.

Optional environment variables:

- `GEMINI_API_KEY` or `VISION_API_KEY` — enables suggestions
- `VISION_MODEL` — default `gemini-flash-latest`
- `VISION_PROVIDER` — `gemini` (default) or `openai`
- `VISION_API_URL` — override the provider URL

Without a key, photos still save locally and the form asks you to type name and expiry.

## Expiry alerts when the app is closed

In-app reminders still appear in the Notifications view. To also get a system notification while the tab is closed:

1. Keep `npm start` running.
2. Open the app on localhost or HTTPS.
3. On Notifications, choose **Enable expiry alerts** and allow the browser permission.

The server generates a local VAPID key pair (no third-party push service account). It pings subscribed browsers when a new 30-day expiry reminder is created, and retries about every 15 minutes (`PUSH_INTERVAL_MS`). Optional `PUSH_CONTACT` is the VAPID `mailto:` subject (default `mailto:household@localhost`).

This is not email. Alerts require this computer’s Node process and a browser that still has the push subscription when running locally. On Cloudflare, a scheduled Worker delivers pushes without your Mac.

## Phone access on your domain (Cloudflare, no Mac)

Production URL: **https://medicineinventory.craftloop.ca**

Deploy with **Cloudflare Workers + D1 + R2** (always on). No tunnel and no `npm start` on your laptop for phone use. Step-by-step: **`deploy/cloudflare-workers.md`**.

Requires **Cloudflare Access** on that hostname and `GEMINI_API_KEY` as a Worker secret. Local dev remains `npm start` → http://127.0.0.1:3000 with SQLite in `data/`.
