import { randomUUID } from 'node:crypto';

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function failure(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/** Normalize only the address used for an invitation lookup/storage. */
export function normalizeInvitationEmail(value) {
  const email = typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw failure('Enter a valid email address.');
  }
  return email;
}

async function ownerHousehold(db, tenant) {
  if (!tenant?.householdId || !tenant?.userId) throw failure('A household membership is required.', 403);
  const membership = await db.prepare("SELECT role FROM memberships WHERE household_id=? AND user_id=?").bind(tenant.householdId, tenant.userId).first();
  if (membership?.role !== 'owner') throw failure('Only a household owner can manage access.', 403);
  return tenant.householdId;
}

export async function listHouseholdAccess(db, tenant) {
  const householdId = await ownerHousehold(db, tenant);
  const members = await db.prepare(`SELECT m.user_id, m.role, MIN(LOWER(i.email)) AS email
    FROM memberships m JOIN identities i ON i.user_id=m.user_id
    WHERE m.household_id=? GROUP BY m.user_id,m.role ORDER BY m.role='owner' DESC, email`).bind(householdId).all();
  const invitations = await db.prepare("SELECT id,email,role,created_at,expires_at FROM household_invitations WHERE household_id=? AND expires_at IS NOT NULL AND expires_at > ? ORDER BY created_at DESC, email").bind(householdId, new Date().toISOString()).all();
  return {
    members: (members.results || []).map(member => ({ email: member.email, role: member.role, is_you: member.user_id === tenant.userId })),
    invitations: invitations.results || []
  };
}

export async function createHouseholdInvitation(db, tenant, data, now = () => new Date().toISOString()) {
  const householdId = await ownerHousehold(db, tenant);
  const email = normalizeInvitationEmail(data?.email);
  const member = await db.prepare(`SELECT 1 FROM memberships m JOIN identities i ON i.user_id=m.user_id
    WHERE m.household_id=? AND LOWER(i.email)=? LIMIT 1`).bind(householdId, email).first();
  if (member) throw failure('This email already belongs to a household member.', 409);
  const created_at = now();
  const expires_at = new Date(new Date(created_at).getTime() + INVITATION_LIFETIME_MS).toISOString();
  const invitation = { id: randomUUID(), email, role: 'member', created_at, expires_at };
  const existing = await db.prepare('SELECT id,expires_at FROM household_invitations WHERE household_id=? AND email=?').bind(householdId, email).first();
  if (existing && (!existing.expires_at || existing.expires_at > created_at)) throw failure('An invitation is already pending for this email.', 409);
  try {
    // Replacement is one D1 transaction. The DELETE is narrowly scoped to the
    // expired row observed for this household/email; a concurrent active invite
    // wins through the table's unique constraint and is reported as a 409.
    await db.batch([
      db.prepare('DELETE FROM household_invitations WHERE id=? AND household_id=? AND email=? AND expires_at IS NOT NULL AND expires_at <= ?')
        .bind(existing?.id || '', householdId, email, created_at),
      db.prepare("INSERT INTO household_invitations (id,household_id,email,role,created_by_user_id,created_at,expires_at) VALUES (?,? ,?,'member',?,?,?)")
        .bind(invitation.id, householdId, email, tenant.userId, invitation.created_at, invitation.expires_at)
    ]);
  } catch (error) {
    if (/unique|constraint/i.test(String(error?.message || ''))) throw failure('An invitation is already pending for this email.', 409);
    throw error;
  }
  return invitation;
}

function invitationId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw failure('Invitation not found.', 404);
  return value;
}

function principalEmail(principal) {
  try { return normalizeInvitationEmail(principal?.email); } catch { throw failure('Invitation not found.', 404); }
}

/** Returns only invitations addressed to the verified Access email. */
export async function pendingHouseholdInvitations(db, principal, now = () => new Date().toISOString()) {
  const email = principalEmail(principal);
  const rows = await db.prepare(`SELECT i.id, i.household_id, h.name AS household_name, i.role, i.expires_at
    FROM household_invitations i JOIN households h ON h.id=i.household_id
    WHERE i.email=? AND i.expires_at IS NOT NULL AND i.expires_at > ?
    ORDER BY i.expires_at ASC, i.id ASC`).bind(email, now()).all();
  // The UI needs only a boolean to avoid ever hiding the normal app from an
  // already enrolled identity that happens to have an unrelated invitation.
  const membership = principal?.provider && principal?.subject
    ? await db.prepare(`SELECT 1 FROM identities i JOIN memberships m ON m.user_id=i.user_id
      WHERE i.provider=? AND i.subject=? LIMIT 1`).bind(principal.provider, principal.subject).first()
    : undefined;
  return { invitations: rows.results || [], member: Boolean(membership) };
}

function batchChanges(result, index) {
  return Number(result?.[index]?.meta?.changes || 0);
}

/**
 * Atomically consumes a specific, unexpired invitation for the verified
 * provider/subject/email. Each INSERT is guarded by the same invitation
 * predicate and the last statement consumes it only after the membership is
 * present. D1 batch statements are one transaction: a uniqueness race rolls
 * back all prior statements, so no orphan user or identity survives.
 */
export async function acceptHouseholdInvitation(db, principal, id, now = () => new Date().toISOString()) {
  invitationId(id);
  const email = principalEmail(principal);
  const stamp = now();
  if (!principal?.provider || !principal?.subject) throw failure('Invitation not found.', 404);
  const identity = await db.prepare('SELECT user_id FROM identities WHERE provider=? AND subject=?')
    .bind(principal.provider, principal.subject).first();

  if (identity) {
    const existingMembership = await db.prepare('SELECT household_id FROM memberships WHERE user_id=? LIMIT 1').bind(identity.user_id).first();
    if (existingMembership) throw failure('This account already belongs to a household.', 409);
    const result = await db.batch([
      db.prepare(`INSERT INTO memberships (household_id,user_id,role,created_at)
        SELECT household_id, ?, 'member', ? FROM household_invitations
        WHERE id=? AND email=? AND role='member' AND expires_at IS NOT NULL AND expires_at > ?
          AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?)`).bind(identity.user_id, stamp, id, email, stamp, identity.user_id),
      db.prepare(`DELETE FROM household_invitations
        WHERE id=? AND email=? AND expires_at IS NOT NULL AND expires_at > ?
          AND EXISTS (SELECT 1 FROM memberships m WHERE m.household_id=household_invitations.household_id AND m.user_id=?)`)
        .bind(id, email, stamp, identity.user_id)
    ]);
    if (batchChanges(result, 1)) return { householdId: (await db.prepare('SELECT household_id FROM memberships WHERE user_id=?').bind(identity.user_id).first()).household_id, role: 'member' };
  } else {
    const userId = randomUUID();
    const result = await db.batch([
      db.prepare(`INSERT INTO users (id,created_at)
        SELECT ?, ? WHERE EXISTS (SELECT 1 FROM household_invitations WHERE id=? AND email=? AND role='member' AND expires_at IS NOT NULL AND expires_at > ?)
          AND NOT EXISTS (SELECT 1 FROM identities WHERE provider=? AND subject=?)`)
        .bind(userId, stamp, id, email, stamp, principal.provider, principal.subject),
      db.prepare(`INSERT INTO identities (provider,subject,user_id,email,created_at)
        SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id=?)
          AND NOT EXISTS (SELECT 1 FROM identities WHERE provider=? AND subject=?)`)
        .bind(principal.provider, principal.subject, userId, email, stamp, userId, principal.provider, principal.subject),
      db.prepare(`INSERT INTO memberships (household_id,user_id,role,created_at)
        SELECT household_id, ?, 'member', ? FROM household_invitations
        WHERE id=? AND email=? AND role='member' AND expires_at IS NOT NULL AND expires_at > ?
          AND EXISTS (SELECT 1 FROM identities WHERE provider=? AND subject=? AND user_id=?)
          AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?)`)
        .bind(userId, stamp, id, email, stamp, principal.provider, principal.subject, userId, userId),
      db.prepare(`DELETE FROM household_invitations
        WHERE id=? AND email=? AND expires_at IS NOT NULL AND expires_at > ?
          AND EXISTS (SELECT 1 FROM memberships m WHERE m.household_id=household_invitations.household_id AND m.user_id=?)`)
        .bind(id, email, stamp, userId)
    ]);
    if (batchChanges(result, 3)) return { householdId: (await db.prepare('SELECT household_id FROM memberships WHERE user_id=?').bind(userId).first()).household_id, role: 'member' };
  }

  // A competing transaction may have attached this identity while ours was
  // serialized. It is a conflict, never an implicit cross-household join.
  const membership = await db.prepare(`SELECT m.household_id FROM identities i JOIN memberships m ON m.user_id=i.user_id
    WHERE i.provider=? AND i.subject=? LIMIT 1`).bind(principal.provider, principal.subject).first();
  if (membership) throw failure('This account already belongs to a household.', 409);
  throw failure('Invitation not found or is no longer available.', 404);
}

export async function revokeHouseholdInvitation(db, tenant, invitationId) {
  const householdId = await ownerHousehold(db, tenant);
  if (typeof invitationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(invitationId)) throw failure('Invitation not found.', 404);
  const result = await db.prepare('DELETE FROM household_invitations WHERE id=? AND household_id=?').bind(invitationId, householdId).run();
  if (!result.meta?.changes) throw failure('Invitation not found.', 404);
}
