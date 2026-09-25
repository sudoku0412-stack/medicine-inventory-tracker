# Medicine Inventory Tracker — Phase 1

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

The SQLite database is created at `data/inventory.sqlite`; it is deliberately excluded from Git. This Phase 1 application is designed for one local household, has no authentication, and must not be exposed publicly. Expiry reminders are in-app only; the reminder generator is kept on the server so email or push delivery can be added later.

Binding `HOST` to a non-loopback address exposes an unauthenticated application and is unsafe unless access controls are provided externally.
