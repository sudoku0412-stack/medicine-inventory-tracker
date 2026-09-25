import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, statusFor, suggestionFromModel, parseModelJson, parseDataUrl, MAX_PHOTO_BYTES, app, suggestFromPhoto, createVapidKeys, createVapidJwt, verifyVapidJwt } from '../server.js';

const fixed = () => new Date('2028-02-01T12:00:00Z');
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'med-track-'));
  return { dir, store: createStore(join(dir, 'db.sqlite'), fixed) };
}
const item = { name: 'Paracetamol', strength: '500 mg', form: 'Tablets', quantity: 10, unit: 'tablets', expiry_date: '2028-02-29', location: 'Cabinet', notes: '', low_stock_threshold: 4 };
const tinyJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';

test('persists batches across reopen', async () => {
  const { dir, store } = fresh();
  const created = await store.create(item);
  store.close();
  const reopened = createStore(join(dir, 'db.sqlite'), fixed);
  assert.equal(reopened.list()[0].id, created.id);
  reopened.close();
  rmSync(dir, { recursive: true });
});

test('rejects invalid fields and consume overdraw', async () => {
  const { dir, store } = fresh();
  await assert.rejects(() => store.create({ ...item, quantity: 0 }));
  await assert.rejects(() => store.create({ ...item, unit: 'pills' }));
  const b = await store.create(item);
  assert.throws(() => store.consume(b.id, 11));
  assert.equal(store.consume(b.id, 4).quantity, 6);
  store.close();
  rmSync(dir, { recursive: true });
});

test('edits and discards a batch', async () => {
  const { dir, store } = fresh();
  const b = await store.create({ ...item, expiry_date: '2028-06-01' });
  assert.equal((await store.update(b.id, { ...b, name: 'Updated', quantity: 3, unit: 'tablets', form: 'Tablets' })).status, 'low');
  await store.discard(b.id);
  assert.equal(store.list().length, 0);
  assert.equal(store.get(b.id), undefined);
  store.close();
  rmSync(dir, { recursive: true });
});

test('uses calendar boundaries for expiry and leap dates', () => {
  assert.equal(statusFor({ expiry_date: '2028-02-28', quantity: 9, low_stock_threshold: 4 }, '2028-02-29'), 'expired');
  assert.equal(statusFor({ expiry_date: '2028-02-29', quantity: 9, low_stock_threshold: 4 }, '2028-02-29'), 'expiring');
  assert.equal(statusFor({ expiry_date: '2028-03-30', quantity: 9, low_stock_threshold: 4 }, '2028-02-29'), 'expiring');
  assert.equal(statusFor({ expiry_date: '2028-03-31', quantity: 2, low_stock_threshold: 4 }, '2028-02-29'), 'low');
});

test('reminders deduplicate, preserve read state, and clear stale entries', async () => {
  const { dir, store } = fresh();
  const b = await store.create(item);
  let ns = store.notifications();
  assert.equal(ns.length, 1);
  store.list();
  assert.equal(store.notifications().length, 1);
  store.read(ns[0].id);
  assert.ok(store.notifications()[0].read_at);
  await store.update(b.id, { ...b, expiry_date: '2028-06-01', unit: 'tablets', form: 'Tablets' });
  assert.equal(store.notifications().length, 0);
  await store.discard(b.id);
  assert.equal(store.notifications().length, 0);
  store.close();
  rmSync(dir, { recursive: true });
});

test('suggestion parser requires a full calendar date and keeps unreadable values manual', () => {
  assert.deepEqual(parseModelJson('Here is {"name":"Amoxicillin","expiry_date":"2029-04-01","expiry_ambiguous":false} done'), {
    name: 'Amoxicillin', expiry_date: '2029-04-01', expiry_ambiguous: false
  });
  const both = suggestionFromModel({ name: '  Ibuprofen  ', expiry_date: '2029-11-30' }, true);
  assert.equal(both.name, 'Ibuprofen');
  assert.equal(both.expiry_date, '2029-11-30');
  assert.equal(both.needs_manual, false);
  const monthOnly = suggestionFromModel({ name: 'Cough syrup', expiry_date: '2029-11', expiry_ambiguous: true }, true);
  assert.equal(monthOnly.expiry_date, null);
  assert.equal(monthOnly.expiry_source, 'manual');
  assert.match(monthOnly.message, /incomplete or unclear/i);
  const invalid = suggestionFromModel({ name: 'X', expiry_date: '2029-02-31' }, true);
  assert.equal(invalid.expiry_date, null);
  const offline = suggestionFromModel({}, false);
  assert.equal(offline.vision, false);
  assert.equal(offline.needs_manual, true);
  assert.match(offline.message, /Gemini API key/);
});

test('stores a packaging photo on create and removes it on discard', async () => {
  const { dir, store } = fresh();
  const created = await store.create({ ...item, photo: tinyJpeg });
  assert.equal(created.has_photo, true);
  assert.equal('photo_path' in created, false);
  const file = store.photoFile(created.id);
  assert.ok(file && existsSync(file));
  assert.ok(readFileSync(file).length > 0);
  await store.discard(created.id);
  assert.equal(existsSync(file), false);
  store.close();
  rmSync(dir, { recursive: true });
});

test('rejects oversized or invalid packaging photos', () => {
  assert.throws(() => parseDataUrl('data:image/gif;base64,AAAA'), /JPEG, PNG, or WebP/);
  assert.throws(() => parseDataUrl('data:image/jpeg;base64,SGVsbG8='), /JPEG, PNG, or WebP/);
  const parsed = parseDataUrl(tinyJpeg);
  assert.equal(parsed.mime, 'image/jpeg');
  const oversized = `data:image/png;base64,${'A'.repeat(Math.ceil((MAX_PHOTO_BYTES + 8) * 4 / 3))}`;
  assert.throws(() => parseDataUrl(oversized), /2 MB/);
});

test('suggest endpoint never auto-saves and uses one mocked vision call', async () => {
  const { dir, store } = fresh();
  let calls = 0;
  const suggest = async () => {
    calls += 1;
    return suggestionFromModel({ name: 'Cetirizine', expiry_date: '2029-08-15' }, true);
  };
  const server = app(store, { suggest, env: { GEMINI_API_KEY: 'test-key' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const status = await fetch(`http://127.0.0.1:${port}/api/packaging/status`).then(r => r.json());
  assert.equal(status.vision, true);
  const suggestion = await fetch(`http://127.0.0.1:${port}/api/packaging/suggest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ photo: tinyJpeg })
  }).then(r => r.json());
  assert.equal(suggestion.name, 'Cetirizine');
  assert.equal(suggestion.expiry_date, '2029-08-15');
  assert.equal(store.list().length, 0);
  assert.equal(calls, 1);
  const created = await fetch(`http://127.0.0.1:${port}/api/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...item, photo: tinyJpeg })
  }).then(r => r.json());
  assert.equal(created.has_photo, true);
  const photo = await fetch(`http://127.0.0.1:${port}/api/batches/${created.id}/photo`);
  assert.equal(photo.status, 200);
  assert.match(photo.headers.get('content-type'), /image\/jpeg/);
  assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
  server.close();
  store.close();
  rmSync(dir, { recursive: true });
});

test('Gemini vision request uses generateContent and parses candidate JSON', async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"name":"Dolo 650","expiry_date":"2029-01-31","expiry_ambiguous":false}' }] } }] })
    };
  };
  const result = await suggestFromPhoto(tinyJpeg, { env: { GEMINI_API_KEY: 'g-test' }, fetchImpl });
  assert.match(captured.url, /gemini-flash-latest:generateContent$/);
  assert.equal(captured.headers['x-goog-api-key'], 'g-test');
  assert.equal(captured.body.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.equal(result.name, 'Dolo 650');
  assert.equal(result.expiry_date, '2029-01-31');
  assert.equal(result.needs_manual, false);
});

test('VAPID JWT signs with the local P-256 key', () => {
  const keys = createVapidKeys();
  const token = createVapidJwt(keys.privateJwk, { aud: 'https://push.example', sub: 'mailto:household@localhost', now: 1_700_000_000_000 });
  assert.equal(verifyVapidJwt(token, keys.publicJwk), true);
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(payload.aud, 'https://push.example');
});

test('push delivery sends once per pending reminder and drops gone endpoints', async () => {
  const { dir, store } = fresh();
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    if (url.endsWith('/gone')) return { ok: false, status: 410 };
    return { ok: true, status: 201 };
  };
  await store.create(item);
  assert.equal(store.notifications()[0].pushed_at, null);
  const none = await store.deliverPushes({ fetchImpl });
  assert.equal(none.sent, 0);
  store.savePushSubscription({ endpoint: 'https://push.example/ok', keys: { p256dh: 'dGVzdA', auth: 'YXV0aA' } });
  store.savePushSubscription({ endpoint: 'https://push.example/gone', keys: { p256dh: 'dGVzdA', auth: 'YXV0aA' } });
  const first = await store.deliverPushes({ fetchImpl });
  assert.equal(first.sent, 1);
  assert.equal(first.gone, 1);
  assert.ok(store.notifications()[0].pushed_at);
  const second = await store.deliverPushes({ fetchImpl });
  assert.equal(second.sent, 0);
  assert.equal(calls.filter(c => c.url === 'https://push.example/ok').length, 1);
  assert.match(calls[0].auth, /^vapid t=.+, k=.+/);
  store.close();
  rmSync(dir, { recursive: true });
});

test('push subscribe endpoint stores a subscription', async () => {
  const { dir, store } = fresh();
  const server = app(store, { fetchImpl: async () => ({ ok: true, status: 201 }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const key = await fetch(`http://127.0.0.1:${port}/api/push/key`).then(r => r.json());
  assert.ok(key.publicKey);
  const saved = await fetch(`http://127.0.0.1:${port}/api/push/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'https://push.example/device', keys: { p256dh: 'dGVzdA', auth: 'YXV0aA' } }) }).then(r => r.json());
  assert.equal(saved.endpoint, 'https://push.example/device');
  server.close();
  store.close();
  rmSync(dir, { recursive: true });
});

test('app.js parses', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'app.js');
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
