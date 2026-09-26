import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('user-facing product copy calls the shared inventory a shop', () => {
  const html = read('public/index.html');
  const renderedText = html.replace(/<[^>]+>/g, ' ');
  const descriptions = [...html.matchAll(/<(?:meta|input|textarea)\b[^>]*(?:content|placeholder)="([^"]*)"[^>]*>/gi)].map(([, value]) => value);
  const ariaLabels = [...html.matchAll(/aria-label="([^"]*)"/gi)].map(([, value]) => value);

  assert.doesNotMatch(renderedText, /household/i);
  assert.doesNotMatch(descriptions.join(' '), /household/i);
  assert.doesNotMatch(ariaLabels.join(' '), /household/i);
  assert.match(html, /<input id="householdName" name="household_name"[^>]*autocomplete="organization"/);
});

test('UI messages and surfaced errors say shop while internal contracts remain household-scoped', () => {
  const app = read('public/app.js');
  const access = read('lib/household-access.js');
  const d1 = read('lib/store-d1.js');
  const shared = read('lib/shared.js');
  const server = read('server.js');

  assert.doesNotMatch(app, /(?:this|a|the|another) household|Household access|household owner|invited to a household|No household invitation/i);
  assert.doesNotMatch(access, /failure\(['"][^'"]*household/i);
  assert.doesNotMatch(d1, /new Error\(['"][^'"]*household/i);
  assert.doesNotMatch(shared, /new Error\(['"][^'"]*household/i);
  assert.match(server, /profileText\(data\.household_name, 'Shop name', 80\)/);
  assert.match(app, /api\/household\/invitations/);
  assert.match(access, /household_id/);
  assert.match(d1, /householdId/);
});

test('tenant bootstrap messages and default name say shop', () => {
  const tenants = read('lib/tenants.js');

  assert.match(tenants, /This account is not a member of a shop\./);
  assert.match(tenants, /'My shop'/);
  assert.match(tenants, /Shop setup is already in progress\./);
  assert.doesNotMatch(tenants, /(?:This account is not a member of a household|Household setup is already in progress|['"]My household['"])/i);

  // SQL identifiers and returned tenant fields remain household-scoped APIs.
  assert.match(tenants, /household_id/);
  assert.match(tenants, /householdId/);
});
