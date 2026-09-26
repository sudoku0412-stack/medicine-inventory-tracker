import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { forms, normalizeBatch, units } from '../lib/shared.js';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const base = { name: 'Example medicine', quantity: 2, expiry_date: null, low_stock_threshold: 1 };

function selectWith(values) {
  const select = { options: [] };
  select.options.push(...values.map(value => ({ value, dataset: {}, remove() { select.options.splice(select.options.indexOf(this), 1); } })));
  select.append = option => { option.remove = () => select.options.splice(select.options.indexOf(option), 1); select.options.push(option); };
  return select;
}

test('medicine form and unit controls separate clinical form from countable dispensing units', () => {
  const formSelect = /<select name="form"[^>]*>(.*?)<\/select>/.exec(page)?.[1] || '';
  const unitSelect = /<select name="unit"[^>]*>(.*?)<\/select>/.exec(page)?.[1] || '';
  assert.deepEqual([...formSelect.matchAll(/<option>([^<]+)<\/option>/g)].map(match => match[1]), ['Tablets', 'Capsules', 'Liquid', 'Cream', 'Inhaler', 'Drops', 'Other']);
  assert.deepEqual([...unitSelect.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(match => [match[1], match[2]]), [
    ['bottle', 'Bottle'], ['sachet', 'Sachet'], ['tube', 'Tube'], ['pack', 'Pack'],
    ['tablet', 'Tablet'], ['capsule', 'Capsule'], ['dose', 'Dose'], ['piece', 'Piece']
  ]);
  assert.match(app, /function preserveSelectValue\(select,value\).*saved value/);
  assert.match(app, /preserveSelectValue\(f\.elements\.form,b\.form\);preserveSelectValue\(f\.elements\.unit,b\.unit\)/);
  const helpers = /function clearSavedSelectValues[\s\S]*?function preserveSelectValue[\s\S]*?(?=function edit)/.exec(app)?.[0];
  assert.ok(helpers, 'legacy select helpers are present');
  const { clearSavedSelectValues, preserveSelectValue } = vm.runInNewContext(`${helpers}; ({clearSavedSelectValues,preserveSelectValue})`, {
    el: (_, props) => ({ value: props.value, dataset: { savedValue: props['data-saved-value'] }, remove() {} })
  });
  const select = selectWith(['tablet']);
  preserveSelectValue(select, 'tablets');
  assert.deepEqual(select.options.map(option => option.value), ['tablet', 'tablets']);
  assert.equal(select.options[1].dataset.savedValue, 'true');
  clearSavedSelectValues(select);
  assert.deepEqual(select.options.map(option => option.value), ['tablet']);
  assert.match(app, /clearSavedSelectValues\(f\.elements\.form\);clearSavedSelectValues\(f\.elements\.unit\);f\.reset\(\)/);
});

test('validation accepts new choices and legacy stored choices without a migration', () => {
  assert.deepEqual(normalizeBatch({ ...base, form: 'Inhaler', unit: 'dose' }, true).unit, 'dose');
  assert.deepEqual(normalizeBatch({ ...base, form: 'Drops', unit: 'piece' }, true).form, 'Drops');
  assert.deepEqual(normalizeBatch({ ...base, form: 'Syrup', unit: 'ml' }, true), {
    ...base, form: 'Syrup', unit: 'ml', strength: '', location: '', notes: ''
  });
  assert.ok(forms.has('Syrup'));
  assert.ok(units.has('tablets'));
  assert.throws(() => normalizeBatch({ ...base, form: 'Injection', unit: 'dose' }, true));
  assert.throws(() => normalizeBatch({ ...base, form: 'Liquid', unit: 'pills' }, true));
});
