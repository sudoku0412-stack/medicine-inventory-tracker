import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { bootstrapEmails, resolveTenant } from '../lib/tenants.js';
import { createD1Store } from '../lib/store-d1.js';
import { createVapidKeys } from '../lib/shared.js';
import { acceptHouseholdInvitation, createHouseholdInvitation, listHouseholdAccess, pendingHouseholdInvitations, revokeHouseholdInvitation } from '../lib/household-access.js';

function d1(sqlite) {
  const statement = sql => {
    const execute = values => ({
      first: async () => sqlite.prepare(sql).get(...values),
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...values).changes } })
    });
    return { ...execute([]), bind: (...values) => execute(values) };
  };
  return { prepare: statement, batch: async rows => {
    sqlite.exec('BEGIN');
    try { const results = []; for (const row of rows) results.push(await row.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}

function tenantDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0003_profile_settings.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0004_household_tenants.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0005_household_invitations.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0006_household_invitation_expiration.sql', import.meta.url), 'utf8'));
  sqlite.prepare("INSERT INTO profile_settings VALUES (1,'Legacy','Legacy house','Medicine cabinet','2026-01-01T00:00:00.000Z')").run();
  sqlite.prepare("INSERT INTO batches (id,name,strength,form,quantity,unit,expiry_date,location,notes,low_stock_threshold,created_at,updated_at) VALUES ('legacy','Medicine','','Tablets',2,'tablets',NULL,'','',1,'2026-01-01','2026-01-01')").run();
  return { sqlite, db: d1(sqlite) };
}

test('only an explicit configured owner can bootstrap legacy rows', async () => {
  const { sqlite, db } = tenantDatabase();
  const env = { INITIAL_OWNER_EMAILS: 'owner@example.test' };
  await assert.rejects(() => resolveTenant(db, { provider: 'cloudflare_access', subject: 'other', email: 'other@example.test' }, env), { status: 403 });
  const owner = await resolveTenant(db, { provider: 'cloudflare_access', subject: 'owner-subject', email: 'owner@example.test' }, env, () => '2026-01-02T00:00:00.000Z');
  assert.equal(sqlite.prepare("SELECT household_id FROM batches WHERE id='legacy'").get().household_id, owner.householdId);
  assert.equal(sqlite.prepare('SELECT household_id FROM household_settings').get().household_id, owner.householdId);
  const repeat = await resolveTenant(db, { provider: 'cloudflare_access', subject: 'owner-subject', email: 'owner@example.test' }, env);
  assert.deepEqual(repeat, owner);
  await assert.rejects(() => resolveTenant(db, { provider: 'cloudflare_access', subject: 'second', email: 'owner@example.test' }, env), { status: 403 });
  sqlite.close();
});

test('a losing bootstrap contention becomes a denial without issuing partial rows', async () => {
  let markerReads = 0;
  let batches = 0;
  const db = {
    prepare(sql) {
      return {
        bind: () => ({ first: async () => sql.includes('tenant_bootstrap') && ++markerReads > 1 ? { household_id: 'winner' } : undefined }),
        first: async () => sql.includes('tenant_bootstrap') && ++markerReads > 1 ? { household_id: 'winner' } : undefined
      };
    },
    batch: async statements => { batches += 1; assert.equal(statements.length, 9); throw new Error('UNIQUE constraint failed: tenant_bootstrap.singleton'); }
  };
  await assert.rejects(() => resolveTenant(db, { provider: 'cloudflare_access', subject: 'loser', email: 'owner@example.test' }, { INITIAL_OWNER_EMAILS: 'owner@example.test' }), { status: 403 });
  assert.equal(batches, 1);
});

test('a household-scoped D1 store cannot list another household’s batches', async () => {
  const { sqlite, db } = tenantDatabase();
  const owner = await resolveTenant(db, { provider: 'cloudflare_access', subject: 'owner', email: 'owner@example.test' }, { INITIAL_OWNER_EMAILS: 'owner@example.test' });
  sqlite.prepare("INSERT INTO users VALUES ('member','now')").run();
  sqlite.prepare("INSERT INTO households VALUES ('other','Other','now')").run();
  sqlite.prepare("INSERT INTO memberships VALUES ('other','member','member','now')").run();
  const store = createD1Store(db, { put: async () => {}, delete: async () => {} }, { publicKey: 'test' }, { householdId: 'other', userId: 'member' });
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.get('legacy'), undefined);
  assert.equal(await store.photoMeta('legacy'), null);
  await assert.rejects(() => store.update('legacy', { name: 'No access' }), { status: 404 });
  assert.equal((await createD1Store(db, { put: async () => {}, delete: async () => {} }, { publicKey: 'test' }, owner).list()).length, 1);
  sqlite.close();
});

test('push endpoint ownership cannot move across households and expired member subscriptions are removed', async () => {
  const { sqlite, db } = tenantDatabase();
  const owner = await resolveTenant(db, { provider: 'cloudflare_access', subject: 'owner', email: 'owner@example.test' }, { INITIAL_OWNER_EMAILS: 'owner@example.test' });
  sqlite.prepare("INSERT INTO users VALUES ('member','now')").run();
  sqlite.prepare("INSERT INTO households VALUES ('other','Other','now')").run();
  sqlite.prepare("INSERT INTO memberships VALUES ('other','member','member','now')").run();
  const photos = { put: async () => {}, delete: async () => {} };
  const ownerStore = createD1Store(db, photos, createVapidKeys(), owner);
  await ownerStore.savePushSubscription({ endpoint: 'https://push.example.test/a', keys: { p256dh: 'key', auth: 'auth' } });
  const otherStore = createD1Store(db, photos, { publicKey: 'test' }, { householdId: 'other', userId: 'member' });
  await assert.rejects(() => otherStore.savePushSubscription({ endpoint: 'https://push.example.test/a', keys: { p256dh: 'key', auth: 'auth' } }), { status: 409 });

  sqlite.prepare("INSERT INTO users VALUES ('member-in-owner','now')").run();
  sqlite.prepare("INSERT INTO memberships VALUES (?,?,?,?)").run(owner.householdId, 'member-in-owner', 'member', 'now');
  sqlite.prepare("INSERT INTO push_subscriptions (endpoint,p256dh,auth,household_id,user_id,created_at) VALUES (?,?,?,?,?,?)").run('https://push.example.test/gone', 'key', 'auth', owner.householdId, 'member-in-owner', 'now');
  sqlite.prepare("INSERT INTO notifications (id,batch_id,household_id,kind,trigger_date,created_at) VALUES ('pending','legacy',?,'test','2026-01-01','now')").run(owner.householdId);
  await ownerStore.deliverPushes({ fetchImpl: async () => ({ status: 410, ok: false }) });
  assert.equal(sqlite.prepare("SELECT endpoint FROM push_subscriptions WHERE endpoint='https://push.example.test/gone'").get(), undefined);
  sqlite.close();
});

test('bootstrap email parsing is case-insensitive and ignores malformed values', () => {
  assert.deepEqual([...bootstrapEmails({ INITIAL_OWNER_EMAILS: ' Owner@Example.test, invalid,SECOND@example.test ' })], ['owner@example.test', 'second@example.test']);
});

test('only owners can list, create, and revoke household invitations', async () => {
  const { sqlite, db } = tenantDatabase();
  const owner = await resolveTenant(db, { provider: 'cloudflare_access', subject: 'owner', email: 'owner@example.test' }, { INITIAL_OWNER_EMAILS: 'owner@example.test' });
  sqlite.prepare("INSERT INTO users VALUES ('member','now')").run();
  sqlite.prepare("INSERT INTO identities VALUES ('cloudflare_access','member-subject','member','member@example.test','now')").run();
  sqlite.prepare("INSERT INTO memberships VALUES (?,?,?,?)").run(owner.householdId, 'member', 'member', 'now');
  const member = { householdId: owner.householdId, userId: 'member' };
  await assert.rejects(() => listHouseholdAccess(db, member), { status: 403 });
  await assert.rejects(() => createHouseholdInvitation(db, member, { email: 'new@example.test' }), { status: 403 });
  const created = await createHouseholdInvitation(db, owner, { email: '  New@Example.test ' }, () => '2026-10-03T00:00:00.000Z');
  assert.deepEqual({ email: created.email, role: created.role, created_at: created.created_at }, { email: 'new@example.test', role: 'member', created_at: '2026-10-03T00:00:00.000Z' });
  const access = await listHouseholdAccess(db, owner);
  assert.deepEqual(access.members, [{ email: 'owner@example.test', role: 'owner', is_you: true }, { email: 'member@example.test', role: 'member', is_you: false }]);
  assert.equal(access.invitations.length, 1);
  await assert.rejects(() => revokeHouseholdInvitation(db, member, created.id), { status: 403 });
  await revokeHouseholdInvitation(db, owner, created.id);
  assert.equal((await listHouseholdAccess(db, owner)).invitations.length, 0);
  sqlite.close();
});

test('invitations remain isolated and never auto-enrol an existing identity', async () => {
  const { sqlite, db } = tenantDatabase();
  const owner = await resolveTenant(db, { provider: 'cloudflare_access', subject: 'owner', email: 'owner@example.test' }, { INITIAL_OWNER_EMAILS: 'owner@example.test' });
  sqlite.prepare("INSERT INTO households VALUES ('other','Other','now')").run();
  sqlite.prepare("INSERT INTO users VALUES ('other-owner','now')").run();
  sqlite.prepare("INSERT INTO identities VALUES ('cloudflare_access','other-owner','other-owner','other@example.test','now')").run();
  sqlite.prepare("INSERT INTO memberships VALUES ('other','other-owner','owner','now')").run();
  await createHouseholdInvitation(db, owner, { email: 'other@example.test' });
  assert.equal(sqlite.prepare("SELECT user_id FROM memberships WHERE household_id=? AND user_id='other-owner'").get(owner.householdId), undefined);
  await assert.rejects(() => createHouseholdInvitation(db, owner, { email: 'OWNER@example.test' }), { status: 409 });
  await assert.rejects(() => createHouseholdInvitation(db, owner, { email: 'other@example.test' }), { status: 409 });
  const otherOwner = { householdId: 'other', userId: 'other-owner' };
  const visibleElsewhere = await listHouseholdAccess(db, otherOwner);
  assert.equal(visibleElsewhere.invitations.length, 0);
  sqlite.close();
});

test('a verified unaffiliated identity can explicitly accept its matching unexpired invitation once', async () => {
  const { sqlite, db } = tenantDatabase();
  const owner = await resolveTenant(db, { provider: 'cloudflare_access', subject: 'owner', email: 'owner@example.test' }, { INITIAL_OWNER_EMAILS: 'owner@example.test' });
  const invitation = await createHouseholdInvitation(db, owner, { email: 'invitee@example.test' }, () => '2026-02-01T00:00:00.000Z');
  const principal = { provider: 'cloudflare_access', subject: 'invitee-subject', email: 'INVITEE@example.test' };
  const pending = await pendingHouseholdInvitations(db, principal, () => '2026-02-02T00:00:00.000Z');
  assert.deepEqual(pending.invitations.map(({ id, household_id, household_name, role, expires_at }) => ({ id, household_id, household_name, role, expires_at })), [{ id: invitation.id, household_id: owner.householdId, household_name: 'My household', role: 'member', expires_at: '2026-02-08T00:00:00.000Z' }]);
  const accepted = await acceptHouseholdInvitation(db, principal, invitation.id, () => '2026-02-02T00:00:00.000Z');
  assert.equal(accepted.householdId, owner.householdId);
  const identity = sqlite.prepare("SELECT user_id,email FROM identities WHERE provider='cloudflare_access' AND subject='invitee-subject'").get();
  assert.equal(identity.email, 'invitee@example.test');
  assert.equal(sqlite.prepare('SELECT role FROM memberships WHERE household_id=? AND user_id=?').get(owner.householdId, identity.user_id).role, 'member');
  assert.equal(sqlite.prepare('SELECT id FROM household_invitations WHERE id=?').get(invitation.id), undefined);
  await assert.rejects(() => acceptHouseholdInvitation(db, principal, invitation.id), { status: 409 });
  sqlite.close();
});

test('acceptance rejects wrong email/id, expiry, revocation, and other-household identities without partial enrollment', async () => {
  const { sqlite, db } = tenantDatabase();
  const owner = await resolveTenant(db, { provider: 'cloudflare_access', subject: 'owner', email: 'owner@example.test' }, { INITIAL_OWNER_EMAILS: 'owner@example.test' });
  const invitation = await createHouseholdInvitation(db, owner, { email: 'invitee@example.test' }, () => '2026-02-01T00:00:00.000Z');
  const wrong = { provider: 'cloudflare_access', subject: 'wrong', email: 'wrong@example.test' };
  await assert.rejects(() => acceptHouseholdInvitation(db, wrong, invitation.id, () => '2026-02-02T00:00:00.000Z'), { status: 404 });
  assert.equal(sqlite.prepare("SELECT 1 FROM identities WHERE subject='wrong'").get(), undefined);
  await assert.rejects(() => acceptHouseholdInvitation(db, { ...wrong, email: 'invitee@example.test' }, '00000000-0000-0000-0000-000000000000'), { status: 404 });
  await assert.rejects(() => acceptHouseholdInvitation(db, { provider: 'cloudflare_access', subject: 'expired', email: 'invitee@example.test' }, invitation.id, () => '2026-02-09T00:00:00.000Z'), { status: 404 });
  assert.equal(sqlite.prepare("SELECT 1 FROM users WHERE id NOT IN (SELECT owner_user_id FROM tenant_bootstrap)").get(), undefined);
  await revokeHouseholdInvitation(db, owner, invitation.id);
  await assert.rejects(() => acceptHouseholdInvitation(db, { provider: 'cloudflare_access', subject: 'revoked', email: 'invitee@example.test' }, invitation.id), { status: 404 });
  sqlite.prepare("INSERT INTO households VALUES ('other','Other','now')").run();
  sqlite.prepare("INSERT INTO users VALUES ('other-user','now')").run();
  sqlite.prepare("INSERT INTO identities VALUES ('cloudflare_access','other-subject','other-user','invitee@example.test','now')").run();
  sqlite.prepare("INSERT INTO memberships VALUES ('other','other-user','member','now')").run();
  const newInvitation = await createHouseholdInvitation(db, owner, { email: 'invitee@example.test' });
  await assert.rejects(() => acceptHouseholdInvitation(db, { provider: 'cloudflare_access', subject: 'other-subject', email: 'invitee@example.test' }, newInvitation.id), { status: 409 });
  assert.ok(sqlite.prepare('SELECT id FROM household_invitations WHERE id=?').get(newInvitation.id));
  sqlite.close();
});

test('concurrent/duplicate acceptance consumes one invitation and cannot leave partial identity rows on a constraint race', async () => {
  const { sqlite, db } = tenantDatabase();
  const owner = await resolveTenant(db, { provider: 'cloudflare_access', subject: 'owner', email: 'owner@example.test' }, { INITIAL_OWNER_EMAILS: 'owner@example.test' });
  const invitation = await createHouseholdInvitation(db, owner, { email: 'race@example.test' });
  const principal = { provider: 'cloudflare_access', subject: 'race-subject', email: 'race@example.test' };
  const outcomes = await Promise.allSettled([acceptHouseholdInvitation(db, principal, invitation.id), acceptHouseholdInvitation(db, principal, invitation.id)]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM identities WHERE subject='race-subject'").get().n, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM memberships WHERE user_id=(SELECT user_id FROM identities WHERE subject='race-subject')").get().n, 1);
  assert.equal(sqlite.prepare('SELECT id FROM household_invitations WHERE id=?').get(invitation.id), undefined);
  sqlite.close();
});

test('an existing identity without a membership is reused, and a D1 batch failure rolls back all new enrollment rows', async () => {
  const { sqlite, db } = tenantDatabase();
  const owner = await resolveTenant(db, { provider: 'cloudflare_access', subject: 'owner', email: 'owner@example.test' }, { INITIAL_OWNER_EMAILS: 'owner@example.test' });
  sqlite.prepare("INSERT INTO users VALUES ('unaffiliated','now')").run();
  sqlite.prepare("INSERT INTO identities VALUES ('cloudflare_access','existing-subject','unaffiliated','reuse@example.test','now')").run();
  const reusable = await createHouseholdInvitation(db, owner, { email: 'reuse@example.test' });
  await acceptHouseholdInvitation(db, { provider: 'cloudflare_access', subject: 'existing-subject', email: 'reuse@example.test' }, reusable.id);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM users WHERE id='unaffiliated'").get().n, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM memberships WHERE user_id='unaffiliated'").get().n, 1);

  const blocked = await createHouseholdInvitation(db, owner, { email: 'blocked@example.test' });
  sqlite.exec("CREATE TRIGGER reject_blocked_identity BEFORE INSERT ON identities WHEN NEW.subject='blocked-subject' BEGIN SELECT RAISE(ABORT, 'forced identity conflict'); END;");
  await assert.rejects(() => acceptHouseholdInvitation(db, { provider: 'cloudflare_access', subject: 'blocked-subject', email: 'blocked@example.test' }, blocked.id), /forced identity conflict/);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM users WHERE id NOT IN (SELECT user_id FROM identities)").get().n, 0);
  assert.ok(sqlite.prepare('SELECT id FROM household_invitations WHERE id=?').get(blocked.id));
  sqlite.close();
});

test('an expired invitation can be replaced only in its own household while an active invitation remains a conflict', async () => {
  const { sqlite, db } = tenantDatabase();
  const owner = await resolveTenant(db, { provider: 'cloudflare_access', subject: 'owner', email: 'owner@example.test' }, { INITIAL_OWNER_EMAILS: 'owner@example.test' });
  const expired = await createHouseholdInvitation(db, owner, { email: 'again@example.test' }, () => '2026-01-01T00:00:00.000Z');
  const replacement = await createHouseholdInvitation(db, owner, { email: 'again@example.test' }, () => '2026-01-09T00:00:00.000Z');
  assert.notEqual(replacement.id, expired.id);
  assert.equal(sqlite.prepare('SELECT id FROM household_invitations WHERE id=?').get(expired.id), undefined);
  assert.equal(sqlite.prepare('SELECT id FROM household_invitations WHERE id=?').get(replacement.id).id, replacement.id);
  await assert.rejects(() => createHouseholdInvitation(db, owner, { email: 'again@example.test' }, () => '2026-01-10T00:00:00.000Z'), { status: 409 });
  sqlite.prepare("INSERT INTO households VALUES ('other','Other','now')").run();
  sqlite.prepare("INSERT INTO users VALUES ('other-owner','now')").run();
  sqlite.prepare("INSERT INTO identities VALUES ('cloudflare_access','other-owner','other-owner','other@example.test','now')").run();
  sqlite.prepare("INSERT INTO memberships VALUES ('other','other-owner','owner','now')").run();
  const otherInvite = await createHouseholdInvitation(db, { householdId: 'other', userId: 'other-owner' }, { email: 'again@example.test' }, () => '2026-01-10T00:00:00.000Z');
  assert.equal(otherInvite.id !== replacement.id, true);
  sqlite.close();
});
