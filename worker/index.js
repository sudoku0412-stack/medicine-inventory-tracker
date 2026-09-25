import {
  MAX_JSON_BYTES,
  accessConfig,
  photoTypes,
  publicAssetPaths,
  requireCloudflareAccess,
  suggestFromPhoto,
  visionConfig
} from '../lib/shared.js';
import { createD1Store, loadVapid } from '../lib/store-d1.js';

const jwksCache = { at: 0, keys: null };

function json(data, status = 200) {
  return new Response(data === undefined ? null : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

async function readJson(request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_JSON_BYTES) throw Object.assign(new Error('Request body too large.'), { status: 413 });
  try {
    const value = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error('Invalid JSON body.'), { status: 400 });
  }
}

async function ensureAccess(request, env) {
  const access = accessConfig(env);
  if (!access) return;
  // Zero Trust already validated the browser session; Cloudflare forwards this to the Worker.
  if (request.headers.get('Cf-Access-Authenticated-User-Email')) return;
  let keys = jwksCache.keys;
  if (!keys || Date.now() - jwksCache.at > 60 * 60 * 1000) {
    const certs = await fetch(access.certs);
    if (!certs.ok) throw Object.assign(new Error('Could not verify Cloudflare Access.'), { status: 503 });
    keys = (await certs.json()).keys || [];
    jwksCache.keys = keys;
    jwksCache.at = Date.now();
  }
  await requireCloudflareAccess(request, { env, now: Date.now(), keys });
}

async function getStore(env) {
  const vapid = await loadVapid(env.KV, env);
  return createD1Store(env.DB, env.PHOTOS, vapid);
}

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    try {
      await ensureAccess(request, env);
      const store = await getStore(env);
      const match = url.pathname.match(/^\/api\/batches\/([^/]+)(?:\/(consume|discard|photo))?$/);
      if (request.method === 'GET' && url.pathname === '/api/settings') return json(await store.settings());
      if (request.method === 'PATCH' && url.pathname === '/api/settings') return json(await store.updateSettings(await readJson(request)));
      if (request.method === 'GET' && url.pathname === '/api/batches') return json(await store.list());
      if (request.method === 'GET' && url.pathname === '/api/packaging/status') return json({ vision: Boolean(visionConfig(env)) });
      if (request.method === 'POST' && url.pathname === '/api/packaging/suggest') {
        const payload = await readJson(request);
        return json(await suggestFromPhoto(payload.photo, { env }));
      }
      if (request.method === 'POST' && url.pathname === '/api/batches') {
        const created = await store.create(await readJson(request));
        ctx.waitUntil(store.deliverPushes({ contact: env.PUSH_CONTACT }));
        return json(created, 201);
      }
      if (match && request.method === 'PATCH' && !match[2]) {
        const updated = await store.update(match[1], await readJson(request));
        ctx.waitUntil(store.deliverPushes({ contact: env.PUSH_CONTACT }));
        return json(updated);
      }
      if (match && request.method === 'POST' && match[2] === 'consume') return json(await store.consume(match[1], (await readJson(request)).amount));
      if (match && request.method === 'POST' && match[2] === 'discard') {
        await store.discard(match[1]);
        return new Response(null, { status: 204 });
      }
      if (match && request.method === 'GET' && match[2] === 'photo') {
        const key = await store.photoMeta(match[1]);
        if (!key) return json({ error: 'Photo not found' }, 404);
        const object = await env.PHOTOS.get(key);
        if (!object) return json({ error: 'Photo not found' }, 404);
        const ext = key.slice(key.lastIndexOf('.'));
        return new Response(object.body, {
          headers: {
            'content-type': photoTypes[ext] || 'application/octet-stream',
            'cache-control': 'private, max-age=3600',
            'x-content-type-options': 'nosniff'
          }
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/notifications') return json(await store.notifications());
      if (request.method === 'POST' && url.pathname === '/api/notifications/read-all') {
        await store.readAll();
        return new Response(null, { status: 204 });
      }
      const n = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
      if (n && request.method === 'POST') {
        await store.read(n[1]);
        return new Response(null, { status: 204 });
      }
      if (request.method === 'GET' && url.pathname === '/api/push/key') return json({ publicKey: store.vapid.publicKey });
      if (request.method === 'POST' && url.pathname === '/api/push/subscribe') {
        const saved = await store.savePushSubscription(await readJson(request));
        ctx.waitUntil(store.deliverPushes({ contact: env.PUSH_CONTACT }));
        return json(saved, 201);
      }
      if (request.method === 'POST' && url.pathname === '/api/push/unsubscribe') {
        await store.removePushSubscription((await readJson(request)).endpoint);
        return new Response(null, { status: 204 });
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      return json({ error: error.message || 'Server error' }, error.status || 500);
    }
  }

  if (request.method !== 'GET' || !publicAssetPaths.has(url.pathname)) return new Response('Not found', { status: 404 });
  const assetPath = url.pathname === '/' ? '/index.html' : url.pathname;
  return env.ASSETS.fetch(new URL(assetPath, request.url));
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    const store = await getStore(env);
    ctx.waitUntil(store.deliverPushes({ contact: env.PUSH_CONTACT }));
  }
};
