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

The SQLite database is created at `data/inventory.sqlite`; it is deliberately excluded from Git. Packaging photos are stored under `data/photos/` and are also excluded. This application is designed for one local household, has no authentication, and must not be exposed publicly. Expiry reminders are in-app only; the reminder generator is kept on the server so email or push delivery can be added later.

Binding `HOST` to a non-loopback address exposes an unauthenticated application and is unsafe unless access controls are provided externally.

## Packaging photos

Add or edit a batch with an optional JPEG, PNG, or WebP photo (2 MB max). The photo is kept only after you save the batch. Manual name, quantity, and expiry entry always remain available.

If `VISION_API_KEY` is set, one vision request can suggest a medicine name and a complete `YYYY-MM-DD` expiry. Incomplete or unreadable dates are left blank so you type them. Suggestions never create a batch on their own; saving the form is the confirmation step.

Optional environment variables:

- `VISION_API_KEY` — required to enable suggestions
- `VISION_API_URL` — OpenAI-compatible chat completions URL (default `https://api.openai.com/v1/chat/completions`)
- `VISION_MODEL` — default `gpt-4o-mini`

Without a key, photos still save locally and the form asks you to type name and expiry.
