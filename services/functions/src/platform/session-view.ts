import type { AtomicTransaction, StoredDocument } from '@zamam/firestore'

/**
 * sessionViews/{userId} is the top-level (non-tenant) read model apps/web/src/auth/session-reader.ts
 * reads directly from Firestore to gate ProtectedRoute. It aggregates membership status across every
 * organization a user belongs to, so callers must read the existing doc (if any) in the same
 * transaction's read phase and pass it in here — this module never reads, only decides what to write,
 * so it can be safely called from the write phase of an already-ordered transaction.
 */
export const sessionViewPath = (userId: string) => `sessionViews/${userId}`

interface MembershipEntry {
  organizationId: string
  status: 'active'
}

function activeMemberships(document: StoredDocument | null): MembershipEntry[] {
  const memberships = document?.memberships
  if (!Array.isArray(memberships)) return []
  return memberships.flatMap((entry): MembershipEntry[] => {
    if (
      entry && typeof entry === 'object'
      && 'organizationId' in entry && typeof entry.organizationId === 'string'
      && 'status' in entry && entry.status === 'active'
    ) {
      return [{ organizationId: entry.organizationId, status: 'active' }]
    }
    return []
  })
}

/**
 * Adds/refreshes this organization's active-membership entry, preserving whatever other organizations'
 * entries already exist (a user can belong to more than one). Only sets displayName/accountStatus when
 * creating the doc for the first time — an update never overwrites them, since callers here (invitation
 * acceptance, admin activation) don't have the user's plaintext email on hand to safely round-trip it.
 */
export function projectMembershipActive(
  transaction: AtomicTransaction,
  existing: StoredDocument | null,
  input: { userId: string; organizationId: string; displayName: string },
) {
  const path = sessionViewPath(input.userId)
  const memberships = [
    ...activeMemberships(existing).filter((entry) => entry.organizationId !== input.organizationId),
    { organizationId: input.organizationId, status: 'active' as const },
  ]
  if (existing) {
    transaction.update(path, { displayName: input.displayName, memberships })
    return
  }
  transaction.create(path, {
    userId: input.userId, displayName: input.displayName, accountStatus: 'active', memberships,
  })
}

/**
 * Removes this organization's entry (membership suspended or ended) so a login attempt no longer sees it
 * as an active membership. A no-op if there is no existing sessionViews doc — nothing to protect against.
 */
export function projectMembershipInactive(
  transaction: AtomicTransaction,
  existing: StoredDocument | null,
  input: { userId: string; organizationId: string },
) {
  if (!existing) return
  const memberships = activeMemberships(existing).filter((entry) => entry.organizationId !== input.organizationId)
  transaction.update(sessionViewPath(input.userId), { memberships })
}
