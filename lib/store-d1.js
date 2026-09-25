import { randomUUID } from 'node:crypto';
import {
  addCalendarDays,
  createVapidKeys,
  endpointAllowed,
  normalizeBatch,
  parseDataUrl,
  publicBatch,
  sendPush,
  text,
  todayISO
} from './shared.js';

const DEFAULT_SETTINGS = Object.freeze({ display_name: 'Kaushik', household_name: 'Kaushik’s home', default_storage_location: 'Medicine cabinet' });
const storageLocations = new Set(['Medicine cabinet', 'Bathroom cabinet', 'Kitchen drawer', 'Refrigerator', 'First aid kit']);

function profileText(value, label, max) {
  const cleaned = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (cleaned.length < 1 || cleaned.length > max) throw Object.assign(new Error(`${label} must be between 1 and ${max} characters.`), { status: 400 });
  return cleaned;
}

function normalizeSettings(data) {
  const display_name = profileText(data.display_name, 'Display name', 60);
  const household_name = profileText(data.household_name, 'Household name', 80);
  const default_storage_location = typeof data.default_storage_location === 'string' ? data.default_storage_location.trim() : '';
  if (!storageLocations.has(default_storage_location)) throw Object.assign(new Error('Choose a valid default storage location.'), { status: 400 });
  return { display_name, household_name, default_storage_location };
}

export async function loadVapid(kv, env) {
  if (env.VAPID_JSON) return JSON.parse(env.VAPID_JSON);
  const saved = await kv.get('vapid');
  if (saved) return JSON.parse(saved);
  const keys = createVapidKeys();
  await kv.put('vapid', JSON.stringify(keys));
  return keys;
}

export function createD1Store(db, photos, vapid, { householdId, userId } = {}, clock = () => new Date()) {
  if (!householdId || !userId) throw Object.assign(new Error('A household membership is required.'), { status: 403 });
  const now = () => clock().toISOString();
  async function reminders() {
    const today = todayISO(clock());
    const end = addCalendarDays(today, 30);
    const due = await db.prepare('SELECT * FROM batches WHERE household_id=? AND discarded_at IS NULL AND quantity > 0 AND expiry_date IS NOT NULL AND expiry_date >= ? AND expiry_date <= ?').bind(householdId, today, end).all();
    await db.prepare(`DELETE FROM notifications WHERE household_id=? AND kind = 'expiry_30' AND NOT EXISTS (SELECT 1 FROM batches b WHERE b.id=notifications.batch_id AND b.household_id=notifications.household_id AND b.discarded_at IS NULL AND b.quantity > 0 AND b.expiry_date=notifications.trigger_date AND b.expiry_date >= ? AND b.expiry_date <= ? )`).bind(householdId, today, end).run();
    const add = db.prepare('INSERT OR IGNORE INTO notifications (id,batch_id,household_id,kind,trigger_date,created_at) VALUES (?,?,?,?,?,?)');
    for (const b of due.results || []) await add.bind(randomUUID(), b.id, householdId, 'expiry_30', b.expiry_date, now()).run();
  }
  async function writePhoto(dataUrl) {
    if (!dataUrl) return null;
    const { buffer, ext, mime } = parseDataUrl(dataUrl);
    const key = `photos/${randomUUID()}${ext}`;
    await photos.put(key, buffer, { httpMetadata: { contentType: mime } });
    return key;
  }
  async function removePhoto(key) {
    if (!key) return;
    try { await photos.delete(key); } catch { /* already gone */ }
  }
  return {
    vapid,
    async settings() {
      const saved = await db.prepare('SELECT display_name,household_name,default_storage_location FROM household_settings WHERE household_id=?').bind(householdId).first();
      if (saved) return saved;
      const settings = { ...DEFAULT_SETTINGS };
      await db.prepare('INSERT OR IGNORE INTO household_settings (household_id,display_name,household_name,default_storage_location,updated_at) VALUES (?,?,?,?,?)').bind(householdId, settings.display_name, settings.household_name, settings.default_storage_location, now()).run();
      return (await db.prepare('SELECT display_name,household_name,default_storage_location FROM household_settings WHERE household_id=?').bind(householdId).first()) || settings;
    },
    async updateSettings(data) {
      const settings = normalizeSettings(data);
      await this.settings();
      await db.prepare('UPDATE household_settings SET display_name=?,household_name=?,default_storage_location=?,updated_at=? WHERE household_id=?').bind(settings.display_name, settings.household_name, settings.default_storage_location, now(), householdId).run();
      return this.settings();
    },
    async list() {
      await reminders();
      const { results } = await db.prepare('SELECT * FROM batches WHERE household_id=? AND discarded_at IS NULL AND quantity > 0 ORDER BY expiry_date IS NULL, expiry_date, name').bind(householdId).all();
      return (results || []).map(b => publicBatch(b, todayISO(clock())));
    },
    async get(id) {
      const row = await db.prepare('SELECT * FROM batches WHERE id=? AND household_id=? AND discarded_at IS NULL').bind(id, householdId).first();
      return publicBatch(row, todayISO(clock()));
    },
    async create(data) {
      const b = normalizeBatch(data, true);
      const id = randomUUID();
      const stamp = now();
      const photo_path = await writePhoto(data.photo);
      await db.prepare('INSERT INTO batches (id,household_id,name,strength,form,quantity,unit,expiry_date,location,notes,low_stock_threshold,photo_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id, householdId, b.name, b.strength, b.form, b.quantity, b.unit, b.expiry_date, b.location, b.notes, b.low_stock_threshold, photo_path, stamp, stamp).run();
      await reminders();
      return this.get(id);
    },
    async photoMeta(id) {
      const row = await db.prepare('SELECT photo_path FROM batches WHERE id=? AND household_id=? AND discarded_at IS NULL').bind(id, householdId).first();
      return row?.photo_path || null;
    },
    async update(id, data) {
      const old = await db.prepare('SELECT * FROM batches WHERE id=? AND household_id=? AND discarded_at IS NULL').bind(id, householdId).first();
      if (!old) throw Object.assign(new Error('Batch not found.'), { status: 404 });
      const b = normalizeBatch({ ...old, ...data });
      let photo_path = old.photo_path;
      if (data.photo === null) {
        await removePhoto(photo_path);
        photo_path = null;
      } else if (data.photo) {
        const next = await writePhoto(data.photo);
        await removePhoto(photo_path);
        photo_path = next;
      }
      await db.prepare('UPDATE batches SET name=?,strength=?,form=?,quantity=?,unit=?,expiry_date=?,location=?,notes=?,low_stock_threshold=?,photo_path=?,updated_at=? WHERE id=? AND household_id=?').bind(b.name, b.strength, b.form, b.quantity, b.unit, b.expiry_date, b.location, b.notes, b.low_stock_threshold, photo_path, now(), id, householdId).run();
      await reminders();
      return this.get(id);
    },
    async consume(id, amount) {
      if (!Number.isInteger(Number(amount)) || Number(amount) < 1) throw Object.assign(new Error('Amount must be a positive whole number.'), { status: 400 });
      const result = await db.prepare('UPDATE batches SET quantity = quantity - ?, updated_at=? WHERE id=? AND household_id=? AND discarded_at IS NULL AND quantity >= ?').bind(Number(amount), now(), id, householdId, Number(amount)).run();
      if (!result.meta.changes) throw Object.assign(new Error('Not enough stock or batch not found.'), { status: 400 });
      await reminders();
      return this.get(id) || { id, quantity: 0, has_photo: false };
    },
    async discard(id) {
      const row = await db.prepare('SELECT photo_path FROM batches WHERE id=? AND household_id=? AND discarded_at IS NULL').bind(id, householdId).first();
      const result = await db.prepare('UPDATE batches SET discarded_at=?,updated_at=? WHERE id=? AND household_id=? AND discarded_at IS NULL').bind(now(), now(), id, householdId).run();
      if (!result.meta.changes) throw Object.assign(new Error('Batch not found.'), { status: 404 });
      await db.prepare('DELETE FROM notifications WHERE batch_id=? AND household_id=?').bind(id, householdId).run();
      await removePhoto(row?.photo_path);
    },
    async notifications() {
      await reminders();
      const { results } = await db.prepare(`SELECT n.*, b.name, b.location, b.expiry_date FROM notifications n JOIN batches b ON b.id=n.batch_id AND b.household_id=n.household_id WHERE n.household_id=? AND b.discarded_at IS NULL ORDER BY n.created_at DESC`).bind(householdId).all();
      return results || [];
    },
    async readAll() {
      await db.prepare('UPDATE notifications SET read_at=? WHERE household_id=? AND read_at IS NULL').bind(now(), householdId).run();
    },
    async read(id) {
      const result = await db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND household_id=?').bind(now(), id, householdId).run();
      if (!result.meta.changes) throw Object.assign(new Error('Notification not found.'), { status: 404 });
    },
    async savePushSubscription(data) {
      const endpoint = text(data.endpoint, 2000);
      const p256dh = text(data.keys?.p256dh || data.p256dh, 200);
      const auth = text(data.keys?.auth || data.auth, 200);
      if (!endpointAllowed(endpoint) || !p256dh || !auth) throw Object.assign(new Error('Invalid push subscription.'), { status: 400 });
      const existing = await db.prepare('SELECT household_id,user_id FROM push_subscriptions WHERE endpoint=?').bind(endpoint).first();
      if (existing && (existing.household_id !== householdId || existing.user_id !== userId)) throw Object.assign(new Error('This push subscription belongs to another household.'), { status: 409 });
      const result = await db.prepare('INSERT INTO push_subscriptions (endpoint,p256dh,auth,household_id,user_id,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth WHERE push_subscriptions.household_id=? AND push_subscriptions.user_id=?').bind(endpoint, p256dh, auth, householdId, userId, now(), householdId, userId).run();
      if (!result.meta.changes) throw Object.assign(new Error('This push subscription belongs to another household.'), { status: 409 });
      return { endpoint };
    },
    async removePushSubscription(endpoint, subscriptionUserId = userId) {
      await db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND household_id=? AND user_id=?').bind(text(endpoint, 2000), householdId, subscriptionUserId).run();
    },
    async deliverPushes({ fetchImpl = fetch, contact = 'mailto:household@craftloop.ca' } = {}) {
      await reminders();
      const pending = await db.prepare('SELECT id FROM notifications WHERE household_id=? AND pushed_at IS NULL').bind(householdId).all();
      const subs = await db.prepare('SELECT endpoint,user_id FROM push_subscriptions WHERE household_id=?').bind(householdId).all();
      if (!(pending.results || []).length || !(subs.results || []).length) return { sent: 0, gone: 0 };
      let sent = 0, gone = 0;
      for (const sub of subs.results || []) {
        try {
          const res = await sendPush(sub.endpoint, vapid, { fetchImpl, contact });
          if (res.status === 404 || res.status === 410) {
            await this.removePushSubscription(sub.endpoint, sub.user_id);
            gone += 1;
            continue;
          }
          if (!res.ok) continue;
          sent += 1;
        } catch {
          continue;
        }
      }
      if (sent) {
        const stamp = now();
        const mark = db.prepare('UPDATE notifications SET pushed_at=? WHERE id=? AND household_id=? AND pushed_at IS NULL');
        for (const n of pending.results || []) await mark.bind(stamp, n.id, householdId).run();
      }
      return { sent, gone };
    }
  };
}
