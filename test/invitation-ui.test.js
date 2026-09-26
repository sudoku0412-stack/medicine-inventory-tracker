import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('invitation expiry formatter accepts a full ISO timestamp instead of date-only parsing', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const match = source.match(/function invitationExpiry\(value\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'invitation expiry formatter is present');
  const formatted = vm.runInNewContext(`${match[0]}; invitationExpiry('2026-10-03T18:45:00.000Z')`, { Date, Intl, Number });
  assert.notEqual(formatted, 'Not available');
  assert.match(formatted, /2026/);
});

test('a mutation retry keeps its operation ID until success or an explicit reset', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const match = source.match(/function operationId\(\)[\s\S]*?(?=function syncConflict)/);
  assert.ok(match, 'mutation intent helpers are present');
  let next = 0;
  const crypto = { randomUUID: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}` };
  const result = vm.runInNewContext(`${match[0]}; const first=syncPayload({amount:1},{revision:3},false,'consume:batch:1'); const retry=syncPayload({amount:1},{revision:3},false,'consume:batch:1'); clearSyncIntent('consume:batch:1'); const nextIntent=syncPayload({amount:1},{revision:3},false,'consume:batch:1'); ({first,retry,nextIntent,transport: definitiveMutationFailure({}),timeout: definitiveMutationFailure({status:408}),rateLimited: definitiveMutationFailure({status:429}),server: definitiveMutationFailure({status:503}),invalid: definitiveMutationFailure({status:400}),conflict: definitiveMutationFailure({status:409})})`, { crypto, Map, Number });
  assert.equal(result.first.operationId, result.retry.operationId);
  assert.equal(result.first.baseRevision, result.retry.baseRevision);
  assert.notEqual(result.first.operationId, result.nextIntent.operationId);
  assert.equal(result.transport, false);
  assert.equal(result.timeout, false);
  assert.equal(result.rateLimited, false);
  assert.equal(result.server, false);
  assert.equal(result.invalid, true);
  assert.equal(result.conflict, true);
});
