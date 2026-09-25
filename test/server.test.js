import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, statusFor } from '../server.js';
const fixed=()=>new Date('2028-02-01T12:00:00Z');
function fresh(){const dir=mkdtempSync(join(tmpdir(),'med-track-'));return {dir,store:createStore(join(dir,'db.sqlite'),fixed)}}
const item={name:'Paracetamol',strength:'500 mg',form:'Tablets',quantity:10,unit:'tablets',expiry_date:'2028-02-29',location:'Cabinet',notes:'',low_stock_threshold:4};
test('persists batches across reopen',()=>{const {dir,store}=fresh(),created=store.create(item);store.close();const reopened=createStore(join(dir,'db.sqlite'),fixed);assert.equal(reopened.list()[0].id,created.id);reopened.close();rmSync(dir,{recursive:true})});
test('rejects invalid fields and consume overdraw',()=>{const {dir,store}=fresh();assert.throws(()=>store.create({...item,quantity:0}));assert.throws(()=>store.create({...item,unit:'pills'}));const b=store.create(item);assert.throws(()=>store.consume(b.id,11));assert.equal(store.consume(b.id,4).quantity,6);store.close();rmSync(dir,{recursive:true})});
test('edits and discards a batch',()=>{const {dir,store}=fresh(),b=store.create({...item,expiry_date:'2028-06-01'});assert.equal(store.update(b.id,{...b,name:'Updated',quantity:3,unit:'tablets',form:'Tablets'}).status,'low');store.discard(b.id);assert.equal(store.list().length,0);assert.equal(store.get(b.id),undefined);store.close();rmSync(dir,{recursive:true})});
test('uses calendar boundaries for expiry and leap dates',()=>{assert.equal(statusFor({expiry_date:'2028-02-28',quantity:9,low_stock_threshold:4},'2028-02-29'),'expired');assert.equal(statusFor({expiry_date:'2028-02-29',quantity:9,low_stock_threshold:4},'2028-02-29'),'expiring');assert.equal(statusFor({expiry_date:'2028-03-30',quantity:9,low_stock_threshold:4},'2028-02-29'),'expiring');assert.equal(statusFor({expiry_date:'2028-03-31',quantity:2,low_stock_threshold:4},'2028-02-29'),'low')});
test('reminders deduplicate, preserve read state, and clear stale entries',()=>{const {dir,store}=fresh(),b=store.create(item);let ns=store.notifications();assert.equal(ns.length,1);store.list();assert.equal(store.notifications().length,1);store.read(ns[0].id);assert.ok(store.notifications()[0].read_at);store.update(b.id,{...b,expiry_date:'2028-06-01',unit:'tablets',form:'Tablets'});assert.equal(store.notifications().length,0);store.discard(b.id);assert.equal(store.notifications().length,0);store.close();rmSync(dir,{recursive:true})});
