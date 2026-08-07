import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { SessionView } from './types'

interface SessionViewDocument {
  displayName?: unknown
  email?: unknown
  accountStatus?: unknown
  memberships?: unknown
  mustChangePassword?: unknown
}

export async function readSessionView(userId: string): Promise<SessionView | null> {
  const snapshot = await getDoc(doc(db, 'sessionViews', userId))
  if (!snapshot.exists()) return null

  const data = snapshot.data() as SessionViewDocument
  const accountStatus = data.accountStatus
  if (accountStatus !== 'active' && accountStatus !== 'disabled' && accountStatus !== 'archived') {
    throw new Error('INVALID_SESSION_VIEW')
  }

  const memberships = Array.isArray(data.memberships)
    ? data.memberships.flatMap((membership): { organizationId: string; status: 'active' }[] => {
        if (
          typeof membership === 'object'
          && membership !== null
          && 'organizationId' in membership
          && typeof membership.organizationId === 'string'
          && 'status' in membership
          && membership.status === 'active'
        ) {
          return [{ organizationId: membership.organizationId, status: 'active' }]
        }
        return []
      })
    : []

  return {
    userId,
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    email: typeof data.email === 'string' ? data.email : null,
    accountStatus,
    memberships,
    // Absent on every sessionViews doc written before this field existed (e.g. owner@zamam.local, bootstrap
    // accounts, anyone accepted via the invite-link flow) — default false so pre-existing accounts are
    // never force-gated by a field they never opted into.
    mustChangePassword: data.mustChangePassword === true,
  }
}
