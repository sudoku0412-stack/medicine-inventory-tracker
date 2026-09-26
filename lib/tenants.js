import { randomUUID } from 'node:crypto';

function forbidden(message = 'This account is not a member of a household.') {
  return Object.assign(new Error(message), { status: 403 });
}

export function bootstrapEmails(env = {}) {
  return new Set(String(env.INITIAL_OWNER_EMAILS || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(value => value && value.includes('@')));
}

/**
 * Resolves a verified Access principal to a household. The only account that
 * can create the first household is an explicitly configured bootstrap owner.
 * A second allowlisted address may not claim an already initialized cabinet.
 */
export async function resolveTenant(db, principal, env, now = () => new Date().toISOString()) {
  if (!principal?.provider || !principal?.subject || !principal?.email) throw forbidden();
  const identity = await db.prepare('SELECT i.user_id, m.household_id, m.role FROM identities i LEFT JOIN memberships m ON m.user_id=i.user_id WHERE i.provider=? AND i.subject=?').bind(principal.provider, principal.subject).first();
  if (identity?.household_id) return { userId: identity.user_id, householdId: identity.household_id, role: identity.role };
  if (identity) throw forbidden();
  if (!bootstrapEmails(env).has(principal.email.toLowerCase())) throw forbidden();

  const existing = await db.prepare('SELECT household_id FROM tenant_bootstrap WHERE singleton=1').first();
  if (existing) throw forbidden();

  const userId = randomUUID();
  const householdId = randomUUID();
  const stamp = now();
  // D1 batches are transactional. The marker is claimed before legacy rows are
  // associated, so an arbitrary later login can never adopt them.
  try {
    await db.batch([
      db.prepare('INSERT INTO users (id,created_at) VALUES (?,?)').bind(userId, stamp),
      db.prepare('INSERT INTO identities (provider,subject,user_id,email,created_at) VALUES (?,?,?,?,?)').bind(principal.provider, principal.subject, userId, principal.email.toLowerCase(), stamp),
      db.prepare('INSERT INTO households (id,name,created_at) VALUES (?,?,?)').bind(householdId, 'My household', stamp),
      db.prepare('INSERT INTO tenant_bootstrap (singleton,household_id,owner_user_id,created_at) VALUES (1,?,?,?)').bind(householdId, userId, stamp),
      db.prepare("INSERT INTO memberships (household_id,user_id,role,created_at) VALUES (?,?,'owner',?)").bind(householdId, userId, stamp),
      db.prepare('UPDATE batches SET household_id=? WHERE household_id IS NULL').bind(householdId),
      db.prepare('UPDATE notifications SET household_id=? WHERE household_id IS NULL').bind(householdId),
      db.prepare('UPDATE push_subscriptions SET household_id=?,user_id=? WHERE household_id IS NULL').bind(householdId, userId),
      // The copied local profile predates verified identity seeding, so it is
      // explicitly seed-eligible rather than user-owned. A later settings
      // PATCH records the user's choice as `user`.
      db.prepare("INSERT OR IGNORE INTO household_settings (household_id,display_name,household_name,default_storage_location,updated_at,display_name_source) SELECT ?,display_name,household_name,default_storage_location,?,'default' FROM profile_settings WHERE singleton=1").bind(householdId, stamp)
    ]);
  } catch (error) {
    // A competing bootstrap can claim the singleton between the read above and
    // this atomic D1 batch. D1 rolls back the whole failed batch; turn only
    // that expected contention into a membership denial.
    const claimed = await db.prepare('SELECT household_id FROM tenant_bootstrap WHERE singleton=1').first();
    if (claimed && /unique|constraint|primary key/i.test(String(error?.message || ''))) throw forbidden('Household setup is already in progress.');
    throw error;
  }
  const claimed = await db.prepare('SELECT household_id,owner_user_id FROM tenant_bootstrap WHERE singleton=1').first();
  if (claimed?.household_id !== householdId || claimed.owner_user_id !== userId) throw forbidden('Household setup is already in progress.');
  return { userId, householdId, role: 'owner' };
}
