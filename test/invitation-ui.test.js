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
