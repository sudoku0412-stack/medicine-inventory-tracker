import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('medicine dialog resets its own scroll position and focuses without moving the viewport', () => {
  assert.match(app, /function openMedicineModal\(focusName=true\)\{const m=qs\('#addMedicineModal'\);m\.showModal\(\);m\.scrollTop=0;requestAnimationFrame\(\(\)=>\{m\.scrollTop=0;if\(focusName\)qs\('#medicineName'\)\.focus\(\{preventScroll:true\}\)\}\)\}/);
  assert.match(app, /async function add\(\)[\s\S]*?openMedicineModal\(\)/);
  assert.match(app, /function edit\(\)[\s\S]*?qs\('#batchModal'\)\.close\(\);openMedicineModal\(\)/);
});

test('mobile dialogs stay bottom-anchored to the dynamic viewport and contain scroll changes', () => {
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.modal \{ position: fixed; inset: auto 0 0;[\s\S]*?max-height: calc\(100dvh - env\(safe-area-inset-top, 0px\)\);[\s\S]*?margin: 0; overflow-anchor: none; overscroll-behavior: contain;/);
});

test('medicine form keeps the expiry-date row unchanged', () => {
  assert.match(page, /<label class="form-field"><span>Quantity <em>\*<\/em><\/span><input name="quantity"[\s\S]*?<label class="form-field"><span>Expiry date<\/span><input name="expiry" type="date" autocomplete="off" \/><\/label>/);
});
