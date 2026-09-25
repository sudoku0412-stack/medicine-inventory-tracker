# Phone access via Cloudflare (Tunnel + Access)

This app stays a Node + SQLite process on your computer. Cloudflare only provides HTTPS on your domain and a login gate. Do not put this tracker on Cloudflare Pages or Workers: those cannot keep `data/inventory.sqlite` or packaging photos.

The Mac (or other always-on box) must keep `npm start` and the tunnel running, or the phone will not load the app.

## What you get

- `https://medicineinventory.craftloop.ca` on a phone
- Camera scan (HTTPS is required; localhost is not available on the phone)
- Same household inventory as desktop
- Cloudflare Access login so the URL is not an open cabinet

## 1. Run the tracker locally

In the project folder:

```sh
npm start
```

Leave this running. Confirm http://127.0.0.1:3000 still works on the Mac.

## 2. Create a Cloudflare Tunnel

1. In Cloudflare Zero Trust, create a **Cloudflare Tunnel** for this machine.
2. Install `cloudflared` on the Mac and log in as the dashboard instructs.
3. Add a **public hostname**:
   - Hostname: **`medicineinventory.craftloop.ca`**
   - Service: `http://127.0.0.1:3000`
4. Keep `HOST` unset so Node still binds to loopback. The tunnel connects outbound; do not publish port 3000.

`craftloop.ca` must use Cloudflare DNS. The tunnel creates the hostname record when you save the public hostname in Zero Trust.

Example config: `deploy/cloudflared.yml.example`. Copy to gitignored `deploy/cloudflared.yml`, fill in the tunnel id and credentials path, and do not commit credentials.

```sh
cloudflared tunnel --config deploy/cloudflared.yml run
```

## 3. Put Cloudflare Access in front

1. Zero Trust → **Access** → **Applications** → add a **self-hosted** application.
   - Application domain: **`medicineinventory.craftloop.ca`**
2. Policy: allow only household emails (one-time PIN or the identity provider you already use).
3. Copy:
   - Team domain (`https://<team>.cloudflareaccess.com`)
   - Application **Audience** (`AUD`)

Create a gitignored `.env` in the project root (never commit it):

```
ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
ACCESS_AUD=<application-audience>
PUSH_CONTACT=mailto:household@craftloop.ca
```

Restart `npm start` after adding `.env` (the server loads gitignored `.env` on start when you run `npm start`).

When those two Access variables are set, requests without a valid Access token receive 401 even if something bypasses the tunnel.

## 4. Phone scan

1. On the phone, open **`https://medicineinventory.craftloop.ca`**
2. Complete the Access login.
3. Add medicine → **Take photo**. Allow camera. Use the back camera when the phone offers it.
4. Confirm Gemini name/expiry, then save.

Safari or Chrome on the phone both work over HTTPS. If camera is blocked, check site permissions for that domain.

## Limits

- Sleeping the Mac, quitting Terminal, or stopping the tunnel takes the phone site down.
- This is still one household. It is not a multi-user cloud product.
- Web push on iOS needs the site added to the Home Screen in some cases; camera scan does not.
