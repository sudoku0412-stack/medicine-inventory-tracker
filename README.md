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

The SQLite database is created at `data/inventory.sqlite`; it is deliberately excluded from Git. VAPID keys for web push are stored at `data/vapid.json` and are also excluded. This application is designed for one local household, has no authentication, and must not be exposed publicly.

Binding `HOST` to a non-loopback address exposes an unauthenticated application and is unsafe unless access controls are provided externally.

## Expiry alerts when the app is closed

In-app reminders still appear in the Notifications view. To also get a system notification while the tab is closed:

1. Keep `npm start` running.
2. Open the app on localhost or HTTPS.
3. On Notifications, choose **Enable expiry alerts** and allow the browser permission.

The server generates a local VAPID key pair (no third-party push service account). It pings subscribed browsers when a new 30-day expiry reminder is created, and retries about every 15 minutes (`PUSH_INTERVAL_MS`). Optional `PUSH_CONTACT` is the VAPID `mailto:` subject (default `mailto:household@localhost`).

This is not email. Alerts require this computer’s Node process and a browser that still has the push subscription. They will not arrive on a phone that never enabled alerts, or if the tracker server is stopped.
