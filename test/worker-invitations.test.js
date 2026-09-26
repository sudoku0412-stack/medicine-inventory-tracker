import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleRequest } from '../worker/index.js';
import { createHouseholdInvitation } from '../lib/household-access.js';
import { resolveTenant } from '../lib/tenants.js';

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
  for (const migration of ['0001_initial.sql', '0003_profile_settings.sql', '0004_household_tenants.sql', '0005_household_invitations.sql', '0006_household_invitation_expiration.sql', '0007_sync_mutation_foundation.sql', '0008_household_display_name_source.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  return { sqlite, db: d1(sqlite) };
}
function request(path, token, method = 'GET') { return new Request(`https://medicineinventory.craftloop.ca${path}`, { method, headers: { 'Cf-Access-Jwt-Assertion': token, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, body: method === 'POST' ? '{}' : undefined }); }

test('pending and accept API routes run before membership resolution but retain signed JWT enforcement', async () => {
  const { sqlite, db } = database();
  const owner = await resolveTenant(db, { provider: 'cloudflare_access', subject: 'owner', email: 'owner@example.test' }, { INITIAL_OWNER_EMAILS: 'owner@example.test' });
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
