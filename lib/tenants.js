import { randomUUID } from 'node:crypto';

function forbidden(message = 'This account is not a member of a shop.') { return Object.assign(new Error(message), { status: 403 }); }
function invalid(message) { return Object.assign(new Error(message), { status: 400 }); }

export function bootstrapEmails(env = {}) {
  return new Set(String(env.INITIAL_OWNER_EMAILS || '').split(',').map(value => value.normalize('NFKC').trim().toLowerCase()).filter(value => value && value.includes('@')));
}

function verifiedPrincipal(principal) {
  if (!principal?.provider || !principal?.subject || !principal?.email) throw forbidden();
  return { ...principal, email: principal.email.normalize('NFKC').trim().toLowerCase() };
}

/** Ordinary membership resolution is deliberately read-only. */
export async function resolveTenant(db, principal) {
  const identity = verifiedPrincipal(principal);
  const member = await db.prepare(`SELECT i.user_id, m.household_id, m.role FROM identities i JOIN memberships m ON m.user_id=i.user_id WHERE i.provider=? AND i.subject=? LIMIT 1`).bind(identity.provider, identity.subject).first();
  if (!member) throw forbidden();
  return { userId: member.user_id, householdId: member.household_id, role: member.role };
}

/** Safe before membership resolution: never returns the configured email allowlist. */
export async function onboardingStatus(db, principal, env) {
  const identity = verifiedPrincipal(principal);
  const member = await db.prepare(`SELECT m.household_id, m.role FROM identities i JOIN memberships m ON m.user_id=i.user_id WHERE i.provider=? AND i.subject=? LIMIT 1`).bind(identity.provider, identity.subject).first();
  const pending = await db.prepare('SELECT 1 FROM household_invitations WHERE email=? AND expires_at > ? LIMIT 1').bind(identity.email, new Date().toISOString()).first();
  if (member) return { membership: { role: member.role }, pendingInvitation: Boolean(pending), setupEligible: false };
  const bootstrap = await db.prepare('SELECT 1 FROM tenant_bootstrap WHERE singleton=1').first();
  return { membership: null, pendingInvitation: Boolean(pending), setupEligible: !bootstrap && bootstrapEmails(env).has(identity.email) };
}

function setupValues(data = {}) {
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim().replace(/\s+/g, ' ') : '';
  const shopName = typeof data.shopName === 'string' ? data.shopName.trim().replace(/\s+/g, ' ') : '';
  if (!displayName || displayName.length > 60) throw invalid('Enter a display name up to 60 characters.');
  if (!shopName || shopName.length > 80) throw invalid('Enter a Shop name up to 80 characters.');
  return { displayName, shopName };
}

async function resolveExisting(db, identity) {
  const member = await db.prepare(`SELECT i.user_id, m.household_id, m.role FROM identities i JOIN memberships m ON m.user_id=i.user_id WHERE i.provider=? AND i.subject=? LIMIT 1`).bind(identity.provider, identity.subject).first();
  return member && { userId: member.user_id, householdId: member.household_id, role: member.role };
}

/** Explicit, atomic, idempotent ownership claim. The bootstrap singleton is the write lock. */
export async function setupInitialShop(db, principal, env, data, { requestId = randomUUID(), now = () => new Date().toISOString() } = {}) {
  const identity = verifiedPrincipal(principal);
  const existing = await resolveExisting(db, identity);
  if (existing) return { ...existing, created: false };
  const bootstrap = await db.prepare('SELECT household_id FROM tenant_bootstrap WHERE singleton=1').first();
  if (bootstrap) throw forbidden('Shop setup is no longer available.');
  if (!bootstrapEmails(env).has(identity.email)) throw forbidden('Shop setup is not available for this account.');
  const { displayName, shopName } = setupValues(data);
  const userId = randomUUID(), householdId = randomUUID(), stamp = now();
  try {
    await db.batch([
      db.prepare('INSERT INTO users (id,created_at) VALUES (?,?)').bind(userId, stamp),
      db.prepare('INSERT INTO identities (provider,subject,user_id,email,created_at) VALUES (?,?,?,?,?)').bind(identity.provider, identity.subject, userId, identity.email, stamp),
      db.prepare('INSERT INTO households (id,name,created_at) VALUES (?,?,?)').bind(householdId, shopName, stamp),
      db.prepare('INSERT INTO tenant_bootstrap (singleton,household_id,owner_user_id,created_at) VALUES (1,?,?,?)').bind(householdId, userId, stamp),
      db.prepare("INSERT INTO memberships (household_id,user_id,role,created_at) VALUES (?,?,'owner',?)").bind(householdId, userId, stamp),
      db.prepare('UPDATE batches SET household_id=? WHERE household_id IS NULL').bind(householdId),
      db.prepare('UPDATE notifications SET household_id=? WHERE household_id IS NULL').bind(householdId),
      db.prepare('UPDATE push_subscriptions SET household_id=?,user_id=? WHERE household_id IS NULL').bind(householdId, userId),
      db.prepare("INSERT INTO household_settings (household_id,display_name,household_name,default_storage_location,updated_at,display_name_source) VALUES (?,?,?,'Medicine cabinet',?,'user')").bind(householdId, displayName, shopName, stamp),
      db.prepare("INSERT INTO access_audit (id,event,household_id,actor_user_id,target_identifier,created_at,request_id) VALUES (?,'bootstrap',?,?,?,?,?)").bind(randomUUID(), householdId, userId, `${identity.provider}:${identity.subject}`, stamp, requestId)
    ]);
  } catch (error) {
    if (/unique|constraint|primary key/i.test(String(error?.message || ''))) {
      const claimed = await resolveExisting(db, identity);
      if (claimed) return { ...claimed, created: false };
      throw forbidden('Shop setup is already complete.');
    }
    throw error;
  }
  return { userId, householdId, role: 'owner', created: true };
}
