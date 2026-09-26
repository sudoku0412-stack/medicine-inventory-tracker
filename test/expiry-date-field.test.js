import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('unknown-expiry choice clears and disables the date, while a known expiry remains editable', () => {
  const helper = /function updateExpiryControl\(\)\{[\s\S]*?\}(?=\nfunction resetPackaging)/.exec(app)?.[0];
  assert.ok(helper, 'expiry control helper is present');
  const dateInput = { value: '2030-05-08', disabled: false };
  const unknown = { checked: true };
  const suggested = [];
  const updateExpiryControl = vm.runInNewContext(`${helper}; updateExpiryControl`, {
    qs: selector => selector === '[name=expiry]' ? dateInput : unknown,
    markSuggested: (...args) => suggested.push(args)
  });

  updateExpiryControl();
  assert.equal(dateInput.disabled, true);
  assert.equal(dateInput.value, '');
  assert.deepEqual(suggested, [['[name=expiry]', false]]);

  unknown.checked = false;
  updateExpiryControl();
  assert.equal(dateInput.disabled, false);
});

test('add, edit, and package suggestions keep expiry state coherent with form and dialog fixes', () => {
  assert.match(app, /clearSavedSelectValues\(f\.elements\.form\);clearSavedSelectValues\(f\.elements\.unit\);f\.reset\(\);updateExpiryControl\(\);/);
  assert.match(app, /qs\('#expiryUnknown'\)\.checked=!b\.expiry_date;updateExpiryControl\(\);[\s\S]*?openMedicineModal\(\)/);
  assert.match(app, /if\(suggestion\.expiry_date\)\{qs\('#expiryUnknown'\)\.checked=false;updateExpiryControl\(\);f\.elements\.expiry\.value=suggestion\.expiry_date;/);
  assert.match(app, /qs\('#expiryUnknown'\)\.addEventListener\('change',updateExpiryControl\)/);
});
