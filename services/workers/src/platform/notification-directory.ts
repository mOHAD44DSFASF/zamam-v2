import type { Auth } from 'firebase-admin/auth'
import type { Firestore } from 'firebase-admin/firestore'
import type { NotificationRecipientDirectory } from '../notification-delivery.js'

const tenantPath = (organizationId: string, kind: string, id: string) => `v2Organizations/${organizationId}/${kind}/${id}`

export function createNotificationRecipientDirectory(firestore: Firestore, auth: Auth): NotificationRecipientDirectory {
  return {
    async resolve(organizationId, userId) {
      const [membership, profile, authUser] = await Promise.all([
        firestore.doc(tenantPath(organizationId, 'organization_membership', userId)).get(),
        firestore.doc(tenantPath(organizationId, 'user_profile', userId)).get(),
        auth.getUser(userId).catch(() => null),
      ])
      return {
        active: membership.exists && membership.data()?.status === 'active' && authUser !== null && !authUser.disabled,
        email: authUser?.email ?? null,
        locale: profile.exists && profile.data()?.locale === 'en' ? 'en' as const : 'ar' as const,
      }
    },
  }
}
