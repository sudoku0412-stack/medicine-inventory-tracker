import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const publicAssets = new Set(['/', '/index.html', '/app.js', '/styles.css', '/sw.js']);
const forms = new Set(['Tablets', 'Capsules', 'Syrup', 'Cream', 'Other']);
const units = new Set(['tablets', 'capsules', 'bottles', 'tubes', 'sachets', 'ml', 'units']);
const photoMimes = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
function looksLikeImage(buffer, mime) {
  if (mime === 'image/jpeg') return buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.length > 7 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
  if (mime === 'image/webp') return buffer.length > 11 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 3 * 1024 * 1024;
const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const dateOK = value => value === null || value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);
const todayISO = (now = new Date()) => [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
const addCalendarDays = (date, days) => { const [y,m,d] = date.split('-').map(Number); return new Date(Date.UTC(y,m-1,d + days)).toISOString().slice(0,10); };

export function statusFor(batch, today = todayISO()) {
  if (!batch.expiry_date) return 'unknown';
  const end = new Date(`${today}T00:00:00`); end.setDate(end.getDate() + 30);
  const endISO = [end.getFullYear(), String(end.getMonth()+1).padStart(2,'0'), String(end.getDate()).padStart(2,'0')].join('-');
  if (batch.expiry_date < today) return 'expired';
  if (batch.expiry_date <= endISO) return 'expiring';
  return batch.quantity <= batch.low_stock_threshold ? 'low' : 'healthy';
}

export function jwkToUncompressedBase64Url(jwk) {
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  if (x.length !== 32 || y.length !== 32) throw new Error('Invalid P-256 public key.');
  return Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64url');
}

export function createVapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicJwk = publicKey.export({ format: 'jwk' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  return { publicJwk, privateJwk, publicKey: jwkToUncompressedBase64Url(publicJwk) };
}

export function loadVapidKeys(file) {
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved?.privateJwk && saved?.publicJwk && saved?.publicKey) return saved;
  }
  const keys = createVapidKeys();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(keys));
  return keys;
}

export function createVapidJwt(privateJwk, { aud, sub, now = Date.now() } = {}) {
  if (!aud || !sub) throw new Error('VAPID token needs audience and subject.');
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub })).toString('base64url');
  const data = `${header}.${payload}`;
  const key = createPrivateKey({ key: privateJwk, format: 'jwk' });
  const sig = sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `${data}.${sig.toString('base64url')}`;
}

export function verifyVapidJwt(token, publicJwk) {
  const [header, payload, signature] = String(token || '').split('.');
  if (!header || !payload || !signature) return false;
  const key = createPublicKey({ key: publicJwk, format: 'jwk' });
  return verify('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
}

function endpointAllowed(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
}

export async function sendPush(endpoint, vapid, { fetchImpl = fetch, contact = 'mailto:household@localhost' } = {}) {
  if (!endpointAllowed(endpoint)) throw Object.assign(new Error('Push endpoint must be HTTPS (or localhost).'), { status: 400 });
  const url = new URL(endpoint);
  const jwt = createVapidJwt(vapid.privateJwk, { aud: `${url.protocol}//${url.host}`, sub: contact });
  return fetchImpl(endpoint, {
    method: 'POST',
    headers: { TTL: '86400', Authorization: `vapid t=${jwt}, k=${vapid.publicKey}` }
  });
}

export function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || '').replace(/\s/g, ''));
  if (!match) throw Object.assign(new Error('Upload a JPEG, PNG, or WebP packaging photo.'), { status: 400 });
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw Object.assign(new Error('Photo data was empty.'), { status: 400 });
  if (buffer.length > MAX_PHOTO_BYTES) throw Object.assign(new Error('Packaging photos must be 2 MB or smaller.'), { status: 413 });
  if (!looksLikeImage(buffer, match[1])) throw Object.assign(new Error('Upload a JPEG, PNG, or WebP packaging photo.'), { status: 400 });
  return { mime: match[1], buffer, ext: photoMimes[match[1]] };
}

export function parseModelJson(textValue) {
  const blob = String(textValue || '').match(/\{[\s\S]*\}/);
  if (!blob) return null;
  try {
    const value = JSON.parse(blob[0]);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function suggestionFromModel(payload, visionConfigured) {
  const name = text(payload?.name, 120) || null;
  let expiry_date = text(payload?.expiry_date, 10) || null;
  const ambiguous = Boolean(payload?.expiry_ambiguous);
  if (!expiry_date || !dateOK(expiry_date)) expiry_date = null;
  if (ambiguous) expiry_date = null;
  const name_source = name ? 'suggested' : 'manual';
  const expiry_source = expiry_date ? 'suggested' : 'manual';
  let message;
  if (!visionConfigured) message = 'Enter the name and expiry yourself. AI suggestions need a Gemini API key.';
  else if (name && expiry_date) message = 'Confirm the suggested name and expiry before saving. Edit anything that looks wrong.';
  else if (name && ambiguous) message = 'Confirm the name. The expiry was incomplete or unclear — enter it manually.';
  else if (name) message = 'Confirm the name. Enter the expiry date yourself.';
  else if (expiry_date) message = 'Confirm the expiry. Enter the medicine name yourself.';
  else message = 'The packaging could not be read clearly. Enter the name and expiry yourself.';
  return { name, expiry_date, name_source, expiry_source, needs_manual: !name || !expiry_date, vision: Boolean(visionConfigured), message };
}

function parseEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function fileSecrets() {
  const out = {};
  const envFile = join(root, '.env');
  const keyFile = join(root, 'data', 'gemini.key');
  if (existsSync(envFile)) Object.assign(out, parseEnvFile(envFile));
  if (existsSync(keyFile)) {
    const raw = readFileSync(keyFile, 'utf8').trim();
    if (raw && !raw.includes('\n') && !raw.includes('=')) out.GEMINI_API_KEY = raw;
    else Object.assign(out, parseEnvFile(keyFile));
  }
  return out;
}

export function visionConfig(env = process.env) {
  const merged = env === process.env ? { ...fileSecrets(), ...env } : { ...env };
  const key = text(merged.GEMINI_API_KEY, 500) || text(merged.VISION_API_KEY, 500);
  if (!key) return null;
  const provider = (text(merged.VISION_PROVIDER, 20) || 'gemini').toLowerCase();
  const model = text(merged.VISION_MODEL, 80) || (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-flash-latest');
  const url = text(merged.VISION_API_URL, 400) || (provider === 'openai'
    ? 'https://api.openai.com/v1/chat/completions'
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
  return { provider: provider === 'openai' ? 'openai' : 'gemini', key, url, model };
}

const PACKAGING_PROMPT = 'Read this medicine packaging photo. Reply with JSON only: {"name": string or null, "expiry_date": "YYYY-MM-DD" or null, "expiry_ambiguous": boolean}. name is the printed medicine name. expiry_date only if a complete calendar day is readable. If only month/year or any digit is unclear, set expiry_date to null and expiry_ambiguous to true. Do not guess missing values.';

export function visionResponseText(body, provider) {
  if (provider === 'openai') return body?.choices?.[0]?.message?.content || '';
  const parts = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map(part => part?.text || '').join('');
}

function visionRequest(config, dataUrl) {
  if (config.provider === 'openai') {
    return {
      url: config.url,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
      body: {
        model: config.model,
        max_tokens: 200,
        temperature: 0,
        messages: [{ role: 'user', content: [{ type: 'text', text: PACKAGING_PROMPT }, { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } }] }]
      }
    };
  }
  const photo = parseDataUrl(dataUrl);
  return {
    url: config.url,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.key },
    body: {
      contents: [{ role: 'user', parts: [{ text: PACKAGING_PROMPT }, { inlineData: { mimeType: photo.mime, data: photo.buffer.toString('base64') } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: 'application/json' }
    }
  };
}

export async function suggestFromPhoto(dataUrl, { env = process.env, fetchImpl = fetch } = {}) {
  parseDataUrl(dataUrl);
  const config = visionConfig(env);
  if (!config) return suggestionFromModel({}, false);
  const request = visionRequest(config, dataUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      signal: controller.signal,
      body: JSON.stringify(request.body)
    });
    if (!response.ok) {
      if (response.status === 503) throw Object.assign(new Error('Gemini is busy. Try the photo again or enter the details yourself.'), { status: 503 });
      throw Object.assign(new Error('Vision provider rejected the request.'), { status: 502 });
    }
    const body = await response.json();
    const parsed = parseModelJson(visionResponseText(body, config.provider));
    if (!parsed) return suggestionFromModel({ expiry_ambiguous: true }, true);
    return suggestionFromModel(parsed, true);
  } catch (error) {
    if (error.status) throw error;
    if (error.name === 'AbortError') throw Object.assign(new Error('Vision suggestion timed out. Enter the details yourself.'), { status: 504 });
    throw Object.assign(new Error('Vision suggestion failed. Enter the details yourself.'), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

function publicBatch(batch, today) {
  if (!batch) return batch;
  const { photo_path, ...rest } = batch;
  return { ...rest, has_photo: Boolean(photo_path), status: statusFor(batch, today) };
}

export function createStore(path = join(root, 'data', 'inventory.sqlite'), clock = () => new Date()) {
  const dataDir = dirname(path);
  const photoDir = join(dataDir, 'photos');
  mkdirSync(dataDir, { recursive: true });
  const vapid = loadVapidKeys(join(dataDir, 'vapid.json'));
  const db = new DatabaseSync(path); db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY,name TEXT NOT NULL,strength TEXT NOT NULL DEFAULT '',form TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity >= 0),unit TEXT NOT NULL,expiry_date TEXT,location TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',low_stock_threshold INTEGER NOT NULL DEFAULT 4 CHECK(low_stock_threshold >= 0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,discarded_at TEXT);
    CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES batches(id),kind TEXT NOT NULL,trigger_date TEXT NOT NULL,read_at TEXT,created_at TEXT NOT NULL,UNIQUE(batch_id,kind,trigger_date));
    CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY,p256dh TEXT NOT NULL,auth TEXT NOT NULL,created_at TEXT NOT NULL);`);
  const columns = db.prepare('PRAGMA table_info(batches)').all().map(c => c.name);
  if (!columns.includes('photo_path')) db.exec('ALTER TABLE batches ADD COLUMN photo_path TEXT');
  const noteCols = db.prepare('PRAGMA table_info(notifications)').all().map(c => c.name);
  if (!noteCols.includes('pushed_at')) db.exec('ALTER TABLE notifications ADD COLUMN pushed_at TEXT');
  const now = () => clock().toISOString();
  function reminders() {
    const today = todayISO(clock());
    const end = addCalendarDays(today, 30);
    const due = db.prepare('SELECT * FROM batches WHERE discarded_at IS NULL AND quantity > 0 AND expiry_date IS NOT NULL AND expiry_date >= ? AND expiry_date <= ?').all(today, end);
    db.prepare(`DELETE FROM notifications WHERE kind = 'expiry_30' AND NOT EXISTS (SELECT 1 FROM batches b WHERE b.id=notifications.batch_id AND b.discarded_at IS NULL AND b.quantity > 0 AND b.expiry_date=notifications.trigger_date AND b.expiry_date >= ? AND b.expiry_date <= ? )`).run(today, end);
    const add = db.prepare('INSERT OR IGNORE INTO notifications (id,batch_id,kind,trigger_date,created_at) VALUES (?,?,?,?,?)');
    due.forEach(b => add.run(randomUUID(), b.id, 'expiry_30', b.expiry_date, now()));
  }
  const normalize = (data, creating = false) => {
    const name = text(data.name, 120);
    const quantity = Number(data.quantity);
    const form = text(data.form, 30);
    const unit = text(data.unit, 20);
    const expiry_date = text(data.expiry_date ?? data.expiry, 10) || null;
    const threshold = data.low_stock_threshold === undefined || data.low_stock_threshold === '' ? 4 : Number(data.low_stock_threshold);
    if (!name || !Number.isInteger(quantity) || quantity < (creating ? 1 : 0) || !forms.has(form) || !units.has(unit) || !dateOK(expiry_date) || !Number.isInteger(threshold) || threshold < 0 || threshold > 1000000) throw Object.assign(new Error('Invalid medicine details.'), { status: 400 });
    return { name, quantity, form, unit, expiry_date, low_stock_threshold: threshold, strength: text(data.strength, 80), location: text(data.location, 100), notes: text(data.notes, 1000) };
  };
  async function writePhoto(dataUrl) {
    if (!dataUrl) return null;
    const { buffer, ext } = parseDataUrl(dataUrl);
    await mkdir(photoDir, { recursive: true });
    const rel = join('photos', `${randomUUID()}${ext}`);
    await writeFile(join(dataDir, rel), buffer);
    return rel;
  }
  async function removePhoto(rel) {
    if (!rel) return;
    const abs = resolve(dataDir, rel);
    if (!abs.startsWith(resolve(dataDir) + '/') && abs !== resolve(dataDir)) return;
    try { await unlink(abs); } catch { /* already gone */ }
  }
  return {
    db,
    dataDir,
    vapid,
    close: () => db.close(),
    list() {
      reminders();
      return db.prepare('SELECT * FROM batches WHERE discarded_at IS NULL AND quantity > 0 ORDER BY expiry_date IS NULL, expiry_date, name').all().map(b => publicBatch(b, todayISO(clock())));
    },
    async create(data) {
      const b = normalize(data, true);
      const id = randomUUID();
      const stamp = now();
      const photo_path = await writePhoto(data.photo);
      db.prepare('INSERT INTO batches (id,name,strength,form,quantity,unit,expiry_date,location,notes,low_stock_threshold,photo_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, b.name, b.strength, b.form, b.quantity, b.unit, b.expiry_date, b.location, b.notes, b.low_stock_threshold, photo_path, stamp, stamp);
      reminders();
      return this.get(id);
    },
    get(id) {
      const b = db.prepare('SELECT * FROM batches WHERE id=? AND discarded_at IS NULL').get(id);
      return publicBatch(b, todayISO(clock()));
    },
    photoFile(id) {
      const b = db.prepare('SELECT photo_path FROM batches WHERE id=? AND discarded_at IS NULL').get(id);
      if (!b?.photo_path) return null;
      const abs = resolve(dataDir, b.photo_path);
      if (!abs.startsWith(resolve(dataDir) + '/') && abs !== resolve(dataDir)) return null;
      if (!existsSync(abs)) return null;
      return abs;
    },
    async update(id, data) {
      const old = db.prepare('SELECT * FROM batches WHERE id=? AND discarded_at IS NULL').get(id);
      if (!old) throw Object.assign(new Error('Batch not found.'), { status: 404 });
      const b = normalize({ ...old, ...data });
      let photo_path = old.photo_path;
      if (data.photo === null) {
        await removePhoto(photo_path);
        photo_path = null;
      } else if (data.photo) {
        const next = await writePhoto(data.photo);
        await removePhoto(photo_path);
        photo_path = next;
      }
      db.prepare('UPDATE batches SET name=?,strength=?,form=?,quantity=?,unit=?,expiry_date=?,location=?,notes=?,low_stock_threshold=?,photo_path=?,updated_at=? WHERE id=?').run(b.name, b.strength, b.form, b.quantity, b.unit, b.expiry_date, b.location, b.notes, b.low_stock_threshold, photo_path, now(), id);
      reminders();
      return this.get(id);
    },
    consume(id, amount) {
      if (!Number.isInteger(Number(amount)) || Number(amount) < 1) throw Object.assign(new Error('Amount must be a positive whole number.'), { status: 400 });
      const result = db.prepare('UPDATE batches SET quantity = quantity - ?, updated_at=? WHERE id=? AND discarded_at IS NULL AND quantity >= ?').run(Number(amount), now(), id, Number(amount));
      if (!result.changes) throw Object.assign(new Error('Not enough stock or batch not found.'), { status: 400 });
      reminders();
      return this.get(id) || { id, quantity: 0, has_photo: false };
    },
    async discard(id) {
      const row = db.prepare('SELECT photo_path FROM batches WHERE id=? AND discarded_at IS NULL').get(id);
      db.exec('BEGIN');
      try {
        const r = db.prepare('UPDATE batches SET discarded_at=?,updated_at=? WHERE id=? AND discarded_at IS NULL').run(now(), now(), id);
        if (!r.changes) throw Object.assign(new Error('Batch not found.'), { status: 404 });
        db.prepare('DELETE FROM notifications WHERE batch_id=?').run(id);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      await removePhoto(row?.photo_path);
    },
    notifications() {
      reminders();
      return db.prepare(`SELECT n.*, b.name, b.location, b.expiry_date FROM notifications n JOIN batches b ON b.id=n.batch_id WHERE b.discarded_at IS NULL ORDER BY n.created_at DESC`).all();
    },
    readAll() { db.prepare('UPDATE notifications SET read_at=? WHERE read_at IS NULL').run(now()); },
    read(id) {
      const r = db.prepare('UPDATE notifications SET read_at=? WHERE id=?').run(now(), id);
      if (!r.changes) throw Object.assign(new Error('Notification not found.'), { status: 404 });
    },
    savePushSubscription(data) {
      const endpoint = text(data.endpoint, 2000);
      const p256dh = text(data.keys?.p256dh || data.p256dh, 200);
      const auth = text(data.keys?.auth || data.auth, 200);
      if (!endpointAllowed(endpoint) || !p256dh || !auth) throw Object.assign(new Error('Invalid push subscription.'), { status: 400 });
      db.prepare('INSERT INTO push_subscriptions (endpoint,p256dh,auth,created_at) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth').run(endpoint, p256dh, auth, now());
      return { endpoint };
    },
    removePushSubscription(endpoint) {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(text(endpoint, 2000));
    },
    async deliverPushes({ fetchImpl = fetch, contact = process.env.PUSH_CONTACT || 'mailto:household@localhost' } = {}) {
      reminders();
      const pending = db.prepare('SELECT id FROM notifications WHERE pushed_at IS NULL').all();
      const subs = db.prepare('SELECT endpoint FROM push_subscriptions').all();
      if (!pending.length || !subs.length) return { sent: 0, gone: 0 };
      let sent = 0, gone = 0;
      for (const sub of subs) {
        try {
          const res = await sendPush(sub.endpoint, vapid, { fetchImpl, contact });
          if (res.status === 404 || res.status === 410) {
            this.removePushSubscription(sub.endpoint);
            gone += 1;
            continue;
          }
          if (!res.ok) continue;
          sent += 1;
        } catch {
          continue;
        }
      }
      if (sent) {
        const stamp = now();
        const mark = db.prepare('UPDATE notifications SET pushed_at=? WHERE id=? AND pushed_at IS NULL');
        pending.forEach(n => mark.run(stamp, n.id));
      }
      return { sent, gone };
    }
  };
}

const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(data === undefined ? '' : JSON.stringify(data)); };
const photoTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export function app(store = createStore(), { suggest = suggestFromPhoto, env = process.env, fetchImpl = fetch } = {}) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && !url.pathname.startsWith('/api/') && !publicAssets.has(url.pathname)) return json(res, 404, { error: 'Not found' });
      const body = async () => {
        let raw = '';
        for await (const c of req) {
          raw += c;
          if (Buffer.byteLength(raw) > MAX_JSON_BYTES) throw Object.assign(new Error('Request body too large.'), { status: 413 });
        }
        try {
          const value = raw ? JSON.parse(raw) : {};
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
          return value;
        } catch {
          throw Object.assign(new Error('Invalid JSON body.'), { status: 400 });
        }
      };
      const match = url.pathname.match(new RegExp('^/api/batches/([^/]+)(?:/(consume|discard|photo))?$'));
      if (req.method === 'GET' && url.pathname === '/api/batches') return json(res, 200, store.list());
      if (req.method === 'GET' && url.pathname === '/api/packaging/status') return json(res, 200, { vision: Boolean(visionConfig(env)) });
      if (req.method === 'POST' && url.pathname === '/api/packaging/suggest') {
        const payload = await body();
        return json(res, 200, await suggest(payload.photo, { env }));
      }
      if (req.method === 'POST' && url.pathname === '/api/batches') {
        const created = await store.create(await body());
        await store.deliverPushes({ fetchImpl });
        return json(res, 201, created);
      }
      if (match && req.method === 'PATCH' && !match[2]) {
        const updated = await store.update(match[1], await body());
        await store.deliverPushes({ fetchImpl });
        return json(res, 200, updated);
      }
      if (match && req.method === 'POST' && match[2] === 'consume') return json(res, 200, store.consume(match[1], (await body()).amount));
      if (match && req.method === 'POST' && match[2] === 'discard') { await store.discard(match[1]); return json(res, 204, {}); }
      if (match && req.method === 'GET' && match[2] === 'photo') {
        const file = store.photoFile(match[1]);
        if (!file) return json(res, 404, { error: 'Photo not found' });
        res.writeHead(200, { 'content-type': photoTypes[extname(file)] || 'application/octet-stream', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
        return res.end(await readFile(file));
      }
      if (req.method === 'GET' && url.pathname === '/api/notifications') return json(res, 200, store.notifications());
      if (req.method === 'POST' && url.pathname === '/api/notifications/read-all') { store.readAll(); return json(res, 204, {}); }
      const n = url.pathname.match(new RegExp('^/api/notifications/([^/]+)/read$'));
      if (n && req.method === 'POST') { store.read(n[1]); return json(res, 204, {}); }
      if (req.method === 'GET' && url.pathname === '/api/push/key') return json(res, 200, { publicKey: store.vapid.publicKey });
      if (req.method === 'POST' && url.pathname === '/api/push/subscribe') {
        const saved = store.savePushSubscription(await body());
        await store.deliverPushes({ fetchImpl });
        return json(res, 201, saved);
      }
      if (req.method === 'POST' && url.pathname === '/api/push/unsubscribe') {
        store.removePushSubscription((await body()).endpoint);
        return json(res, 204, {});
      }
      if (req.method === 'GET') {
        const file = resolve(root, url.pathname === '/' ? 'index.html' : '.' + url.pathname);
        if (!file.startsWith(root)) return json(res, 404, { error: 'Not found' });
        try { await stat(file); } catch { return json(res, 404, { error: 'Not found' }); }
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
        res.writeHead(200, { 'content-type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8` });
        return res.end(await readFile(file));
      }
      return json(res, 404, { error: 'Not found' });
    } catch (e) {
      json(res, e.status || 500, { error: e.message || 'Server error' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const port = process.env.PORT || 3000;
  const store = createStore();
  const server = app(store);
  const tick = () => store.deliverPushes().catch(err => console.error('Push delivery failed:', err.message));
  server.listen(port, host, () => {
    console.log(`Medicine Tracker on http://${host}:${port}`);
    tick();
    const ms = Number(process.env.PUSH_INTERVAL_MS) || 15 * 60 * 1000;
    setInterval(tick, ms);
  });
}
