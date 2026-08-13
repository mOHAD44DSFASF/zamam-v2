import type { Firestore } from 'firebase-admin/firestore'
import { defaultRoleDocId } from '@zamam/authorization'
import { isTaskStalled } from '@zamam/domain'
import type { DigestContentPort, DigestRecipient, DigestRecipientPort, DigestScope } from '../daily-digest.js'

const tenantCollection = (organizationId: string, kind: string) => `v2Organizations/${organizationId}/${kind}`

const ORG_ROLE_IDS = new Set([defaultRoleDocId('Owner'), defaultRoleDocId('GeneralManager'), defaultRoleDocId('Manager')])
const DEPARTMENT_LEAD_ROLE_ID = defaultRoleDocId('DepartmentLead')

export function createFirestoreDigestRecipientPort(firestore: Firestore): DigestRecipientPort {
  return {
    async listActiveRecipients(organizationId, limit) {
      const [assignments, memberships] = await Promise.all([
        firestore.collection(tenantCollection(organizationId, 'role_assignment'))
          .where('status', '==', 'active').where('effect', '==', 'grant').limit(500).get(),
        firestore.collection(tenantCollection(organizationId, 'organization_membership'))
          .where('status', '==', 'active').limit(limit).get(),
      ])
      // Highest-privilege scope wins per user if they somehow hold more than one role assignment.
      const scopeByUser = new Map<string, DigestScope>()
      for (const doc of assignments.docs) {
        const data = doc.data()
        const userId = String(data.userId)
        const roleId = String(data.roleId)
        if (ORG_ROLE_IDS.has(roleId) && data.scopeType === 'organization') { scopeByUser.set(userId, { type: 'organization' }); continue }
        if (roleId === DEPARTMENT_LEAD_ROLE_ID && data.scopeType === 'department' && scopeByUser.get(userId)?.type !== 'organization') {
          scopeByUser.set(userId, { type: 'department', departmentId: String(data.scopeId) })
        }
      }
      const userIds = memberships.docs.map((doc) => doc.id)
      const profiles = await Promise.all(userIds.map((userId) => firestore.doc(`${tenantCollection(organizationId, 'user_profile')}/${userId}`).get()))
      const recipients: DigestRecipient[] = userIds.map((userId, index) => {
        const profile = profiles[index]
        const timezone = profile?.exists && typeof profile.data()?.timezone === 'string' ? String(profile.data()!.timezone) : 'Asia/Riyadh'
        const scope = scopeByUser.get(userId) ?? { type: 'employee' as const, userId }
        return { userId, timezone, scope }
      })
      return recipients
    },
  }
}

/** "Due today" compares calendar dates in UTC, not each recipient's own timezone — task due dates carry no
 * inherent timezone of their own beyond their UTC instant, so a per-recipient-local comparison would need
 * a policy decision (whose "today" wins?) this feature doesn't need to make; UTC-day is a reasonable,
 * disclosed approximation for a summary count, off by at most a few hours near midnight. */
const todayUtc = (isoNow: string) => isoNow.slice(0, 10)

export function createFirestoreDigestContentPort(firestore: Firestore): DigestContentPort {
  return {
    async countForScope(organizationId, scope, now) {
      const nowMs = Date.parse(now)
      const todayLocal = todayUtc(now)
      let query = firestore.collection(tenantCollection(organizationId, 'task')).where('status', '==', 'in_progress')
      if (scope.type === 'department') query = query.where('departmentId', '==', scope.departmentId)
      if (scope.type === 'employee') query = query.where('currentStepAssigneeUserId', '==', scope.userId)
      const snapshot = await query.limit(500).get()
      let dueToday = 0
      let stalledOrOverdue = 0
      for (const doc of snapshot.docs) {
        const data = doc.data()
        const dueAt = typeof data.currentStepDueAt === 'string' ? data.currentStepDueAt : null
        const enteredAt = typeof data.currentStepEnteredAt === 'string' ? data.currentStepEnteredAt : null
        const stepStatus = typeof data.currentStepStatus === 'string' ? data.currentStepStatus : null
        if (dueAt && dueAt.slice(0, 10) === todayLocal) dueToday += 1
        if (isTaskStalled({ status: 'in_progress', currentStepStatus: stepStatus, currentStepDueAt: dueAt, currentStepEnteredAt: enteredAt }, nowMs)) stalledOrOverdue += 1
      }
      return { dueToday, stalledOrOverdue }
    },
  }
}
