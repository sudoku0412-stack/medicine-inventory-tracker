import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { requireCloudflareAccess } from '../lib/shared.js';

const env = { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'medicine-audience' };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(claims = {}) {
  const header = b64({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const payload = b64({ iss: 'https://team.cloudflareaccess.com', aud: 'medicine-audience', exp: Math.floor(Date.now() / 1000) + 60, sub: 'access-subject', email: 'owner@example.test', ...claims });
  const data = `${header}.${payload}`;
  return `${data}.${sign('sha256', Buffer.from(data), privateKey).toString('base64url')}`;
}
const source = value => new Request('https://medicineinventory.craftloop.ca/api/batches', { headers: value ? { 'Cf-Access-Jwt-Assertion': value } : { 'Cf-Access-Authenticated-User-Email': 'spoofed@example.test' } });

test('Access JWT verification rejects forged, wrong issuer/audience, expired, and header-only identity', async () => {
  const options = { env, keys: [jwk], now: Date.now };
  await assert.rejects(() => requireCloudflareAccess(source(`${token()}.forged`), options), { status: 401 });
  await assert.rejects(() => requireCloudflareAccess(source(token({ iss: 'https://other.cloudflareaccess.com' })), options), { status: 401 });
  await assert.rejects(() => requireCloudflareAccess(source(token({ aud: 'wrong' })), options), { status: 401 });
  await assert.rejects(() => requireCloudflareAccess(source(token({ exp: Math.floor(Date.now() / 1000) - 1 })), options), { status: 401 });
  await assert.rejects(() => requireCloudflareAccess(source(), options), { status: 401 });
});

test('Access JWT verification returns only a verified principal', async () => {
  const principal = await requireCloudflareAccess(source(token()), { env, keys: [jwk], now: Date.now });
  assert.deepEqual(principal, { provider: 'cloudflare_access', subject: 'access-subject', email: 'owner@example.test' });
});
