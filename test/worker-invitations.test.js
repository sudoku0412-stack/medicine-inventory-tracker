import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleRequest } from '../worker/index.js';
import { createHouseholdInvitation } from '../lib/household-access.js';
import { setupInitialShop } from '../lib/tenants.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'invite-key', alg: 'RS256', use: 'sig' };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt({ subject, email, ...claims }) {
  const header = b64({ alg: 'RS256', kid: 'invite-key', typ: 'JWT' });
  const payload = b64({ iss: 'https://team.cloudflareaccess.com', aud: 'medicine-audience', exp: Math.floor(Date.now() / 1000) + 60, sub: subject, email, ...claims });
  const data = `${header}.${payload}`;
  return `${data}.${sign('sha256', Buffer.from(data), privateKey).toString('base64url')}`;
}
function d1(sqlite) {
  const prepare = sql => ({ bind: (...values) => ({ first: async () => sqlite.prepare(sql).get(...values), all: async () => ({ results: sqlite.prepare(sql).all(...values) }), run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...values).changes } }) }), first: async () => sqlite.prepare(sql).get(), all: async () => ({ results: sqlite.prepare(sql).all() }), run: async () => ({ meta: { changes: sqlite.prepare(sql).run().changes } }) });
  return { prepare, batch: async statements => { sqlite.exec('BEGIN'); try { const out=[]; for (const statement of statements) out.push(await statement.run()); sqlite.exec('COMMIT'); return out; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
}
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0001_initial.sql', '0003_profile_settings.sql', '0004_household_tenants.sql', '0005_household_invitations.sql', '0006_household_invitation_expiration.sql', '0007_sync_mutation_foundation.sql', '0008_household_display_name_source.sql', '0009_seed_legacy_household_display_names.sql', '0010_access_audit.sql', '0011_user_shop_preferences.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  return { sqlite, db: d1(sqlite) };
}
function request(path, token, method = 'GET') { return new Request(`https://medicineinventory.craftloop.ca${path}`, { method, headers: { 'Cf-Access-Jwt-Assertion': token, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, body: method === 'POST' ? '{}' : undefined }); }
function shopRequest(path, token, { method = 'GET', shopId, body } = {}) {
  return new Request(`https://medicineinventory.craftloop.ca${path}`, {
    method,
    headers: { 'Cf-Access-Jwt-Assertion': token, ...(shopId ? { 'X-Shop-Id': shopId } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

test('Shop onboarding status is read-only and explicit setup creates the verified owner', async () => {
  const { sqlite, db } = database();
  const env = { DB: db, ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'medicine-audience', INITIAL_OWNER_EMAILS: 'kmaz285@gmail.com', KV: { get: async () => null, put: async () => {} }, PHOTOS: {} };
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  try {
    const token = jwt({ subject: 'first-owner', email: 'kmaz285@gmail.com' });
    const status = await handleRequest(request('/api/shop/onboarding-status', token), env, { waitUntil() {} });
    assert.deepEqual(await status.json(), { membership: null, pendingInvitation: false, setupEligible: true });
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM tenant_bootstrap').get().n, 0);
    const setupRequest = new Request('https://medicineinventory.craftloop.ca/api/shop/onboarding', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': token, 'content-type': 'application/json', 'cf-ray': 'test-correlation' }, body: JSON.stringify({ shopName: 'Mendicie', displayName: 'Kaushik' }) });
    const setup = await handleRequest(setupRequest, env, { waitUntil() {} });
    assert.equal(setup.status, 201);
    assert.equal((await setup.json()).role, 'owner');
    assert.equal(sqlite.prepare("SELECT request_id FROM access_audit WHERE event='bootstrap'").get().request_id, 'test-correlation');
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test('pending and accept API routes run before membership resolution but retain signed JWT enforcement', async () => {
  const { sqlite, db } = database();
  const owner = await setupInitialShop(db, { provider: 'cloudflare_access', subject: 'owner', email: 'owner@example.test' }, { INITIAL_OWNER_EMAILS: 'owner@example.test' }, { displayName: 'Owner', shopName: 'Test Shop' });
  const invitation = await createHouseholdInvitation(db, owner, { email: 'invitee@example.test' });
  const env = { DB: db, ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'medicine-audience', INITIAL_OWNER_EMAILS: 'owner@example.test', KV: { get: async () => null, put: async () => {} }, PHOTOS: {} };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  try {
    const unaffiliated = jwt({ subject: 'invitee', email: 'invitee@example.test' });
    const pending = await handleRequest(request('/api/household/invitations/pending', unaffiliated), env, { waitUntil() {} });
    assert.equal(pending.status, 200);
    assert.equal((await pending.json()).invitations[0].id, invitation.id);
    const accepted = await handleRequest(request(`/api/household/invitations/${invitation.id}/accept`, unaffiliated, 'POST'), env, { waitUntil() {} });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).role, 'member');
    const normal = await handleRequest(request('/api/settings', unaffiliated), env, { waitUntil() {} });
    assert.equal(normal.status, 200);
    // A member may receive an unrelated invitation from another household, but
    // the pre-tenant discovery route must tell the browser to open the normal
    // app rather than showing an acceptance gate.
    sqlite.exec("INSERT INTO households VALUES ('other','Other','now'); INSERT INTO users VALUES ('other-owner','now'); INSERT INTO identities VALUES ('cloudflare_access','other-owner','other-owner','other@example.test','now'); INSERT INTO memberships VALUES ('other','other-owner','owner','now');");
    await createHouseholdInvitation(db, { householdId: 'other', userId: 'other-owner' }, { email: 'invitee@example.test' });
    const memberPending = await handleRequest(request('/api/household/invitations/pending', unaffiliated), env, { waitUntil() {} });
    const memberPayload = await memberPending.json();
    assert.equal(memberPayload.member, true);
    assert.equal(memberPayload.invitations.length, 1);
    const forged = await handleRequest(request('/api/household/invitations/pending', `${unaffiliated}.forged`), env, { waitUntil() {} });
    assert.equal(forged.status, 401);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test('Shop context lists only caller memberships, enforces the selected membership, and persists a valid preference', async () => {
  const { sqlite, db } = database();
  const owner = await setupInitialShop(db, { provider: 'cloudflare_access', subject: 'shared-user', email: 'shared@example.test' }, { INITIAL_OWNER_EMAILS: 'shared@example.test' }, { displayName: 'Shared', shopName: 'Zeta Shop' });
  sqlite.exec("INSERT INTO households VALUES ('alpha','Alpha Shop','now'); INSERT INTO memberships VALUES ('alpha','" + owner.userId + "','member','now'); INSERT INTO users VALUES ('outsider','now'); INSERT INTO identities VALUES ('cloudflare_access','outsider-subject','outsider','outsider@example.test','now'); INSERT INTO memberships VALUES ('alpha','outsider','owner','now');");
  const env = { DB: db, ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'medicine-audience', KV: { get: async () => JSON.stringify({ publicKey: 'test' }), put: async () => {} }, PHOTOS: { put: async () => {}, delete: async () => {} } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  try {
    const token = jwt({ subject: 'shared-user', email: 'shared@example.test' });
    const defaultContext = await handleRequest(shopRequest('/api/shops', token), env, { waitUntil() {} });
    assert.equal(defaultContext.status, 200);
    assert.equal(defaultContext.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await defaultContext.json()).shops, [
      { id: 'alpha', name: 'Alpha Shop', role: 'member' },
      { id: owner.householdId, name: 'Zeta Shop', role: 'owner' }
    ]);
    const selectOwner = await handleRequest(shopRequest('/api/shops', token, { shopId: owner.householdId }), env, { waitUntil() {} });
    assert.equal((await selectOwner.json()).activeShopId, owner.householdId);
    assert.equal(sqlite.prepare('SELECT household_id FROM user_shop_preferences WHERE user_id=?').get(owner.userId).household_id, owner.householdId);
    const preferredContext = await handleRequest(shopRequest('/api/shops', token), env, { waitUntil() {} });
    assert.equal((await preferredContext.json()).activeShopId, owner.householdId);
    const rejected = await handleRequest(shopRequest('/api/batches', token, { shopId: 'not-a-membership' }), env, { waitUntil() {} });
    assert.equal(rejected.status, 403);
    const createInAlpha = await handleRequest(shopRequest('/api/batches', token, { method: 'POST', shopId: 'alpha', body: { name: 'Alpha-only', form: 'Tablets', quantity: 2, unit: 'tablets', low_stock_threshold: 1 } }), env, { waitUntil() {} });
    assert.equal(createInAlpha.status, 201);
    const ownerBatches = await handleRequest(shopRequest('/api/batches', token, { shopId: owner.householdId }), env, { waitUntil() {} });
    assert.deepEqual(await ownerBatches.json(), []);
    const alphaBatches = await handleRequest(shopRequest('/api/batches', token, { shopId: 'alpha' }), env, { waitUntil() {} });
    assert.equal((await alphaBatches.json())[0].name, 'Alpha-only');
    sqlite.prepare('UPDATE user_shop_preferences SET household_id=? WHERE user_id=?').run('alpha', owner.userId);
    sqlite.prepare('DELETE FROM memberships WHERE household_id=? AND user_id=?').run('alpha', owner.userId);
    const fallback = await handleRequest(shopRequest('/api/shops', token), env, { waitUntil() {} });
    assert.equal((await fallback.json()).activeShopId, owner.householdId);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});
