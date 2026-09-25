import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, createStore } from '../server.js';

const fixed = () => new Date('2028-02-01T12:00:00Z');
const item = { name: 'Paracetamol', strength: '500 mg', form: 'Tablets', quantity: 10, unit: 'tablets', expiry_date: '2028-02-29', location: 'Cabinet', notes: '', low_stock_threshold: 4 };

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'profile-settings-'));
  return { dir, store: createStore(join(dir, 'db.sqlite'), fixed) };
}

test('profile settings persist separately from medicine data and validate their limits', async () => {
  const { dir, store } = fresh();
  try {
    assert.deepEqual(store.settings(), { display_name: 'Kaushik', household_name: 'Kaushik’s home', default_storage_location: 'Medicine cabinet' });
    const batch = await store.create(item);
    const saved = store.updateSettings({ display_name: 'Asha Patel', household_name: 'Patel home', default_storage_location: 'Refrigerator' });
    assert.deepEqual(saved, { display_name: 'Asha Patel', household_name: 'Patel home', default_storage_location: 'Refrigerator' });
    assert.equal(store.get(batch.id).location, 'Cabinet');
    assert.throws(() => store.updateSettings({ ...saved, display_name: '' }), /Display name/);
    assert.throws(() => store.updateSettings({ ...saved, household_name: 'x'.repeat(81) }), /Household name/);
    assert.throws(() => store.updateSettings({ ...saved, default_storage_location: 'Garage' }), /default storage location/i);
    store.close();
    const reopened = createStore(join(dir, 'db.sqlite'), fixed);
    assert.deepEqual(reopened.settings(), saved);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('settings API returns and updates the singleton profile', async () => {
  const { dir, store } = fresh();
  const server = app(store);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const initial = await fetch(`http://127.0.0.1:${port}/api/settings`).then(r => r.json());
    assert.equal(initial.display_name, 'Kaushik');
    const response = await fetch(`http://127.0.0.1:${port}/api/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Mina', household_name: 'Mina’s home', default_storage_location: 'First aid kit' }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { display_name: 'Mina', household_name: 'Mina’s home', default_storage_location: 'First aid kit' });
    const invalid = await fetch(`http://127.0.0.1:${port}/api/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Mina', household_name: 'Mina’s home', default_storage_location: 'Garage' }) });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('profile provides a same-origin Cloudflare Access sign-out action', () => {
  const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(page, /<h2 id="signOutTitle">Sign out<\/h2>/);
  assert.match(page, /href="\/cdn-cgi\/access\/logout">Sign out<\/a>/);
  assert.match(page, /Sign out of Cloudflare Access on this device\./);
});
