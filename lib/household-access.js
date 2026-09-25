import { randomUUID } from 'node:crypto';

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
  const invitations = await db.prepare("SELECT id,email,role,created_at FROM household_invitations WHERE household_id=? ORDER BY created_at DESC, email").bind(householdId).all();
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
  const existing = await db.prepare('SELECT id FROM household_invitations WHERE household_id=? AND email=?').bind(householdId, email).first();
  if (existing) throw failure('An invitation is already pending for this email.', 409);
  const invitation = { id: randomUUID(), email, role: 'member', created_at: now() };
  try {
    await db.prepare("INSERT INTO household_invitations (id,household_id,email,role,created_by_user_id,created_at) VALUES (?,? ,?,'member',?,?)")
      .bind(invitation.id, householdId, email, tenant.userId, invitation.created_at).run();
  } catch (error) {
    if (/unique|constraint/i.test(String(error?.message || ''))) throw failure('An invitation is already pending for this email.', 409);
    throw error;
  }
  return invitation;
}

export async function revokeHouseholdInvitation(db, tenant, invitationId) {
  const householdId = await ownerHousehold(db, tenant);
  if (typeof invitationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(invitationId)) throw failure('Invitation not found.', 404);
  const result = await db.prepare('DELETE FROM household_invitations WHERE id=? AND household_id=?').bind(invitationId, householdId).run();
  if (!result.meta?.changes) throw failure('Invitation not found.', 404);
}
