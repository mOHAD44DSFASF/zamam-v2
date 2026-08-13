import type { Firestore } from 'firebase-admin/firestore'
import { defaultRoleDocId } from '@zamam/authorization'
import type { EscalationRecipientPort, StalledTaskLookupPort, StalledTaskRow } from '../stalled-task-escalation.js'

const tenantCollection = (organizationId: string, kind: string) => `v2Organizations/${organizationId}/${kind}`

export function createFirestoreStalledTaskLookupPort(firestore: Firestore): StalledTaskLookupPort {
  return {
    async listInProgress(organizationId, limit) {
      const snapshot = await firestore.collection(tenantCollection(organizationId, 'task'))
        .where('status', '==', 'in_progress').limit(limit).get()
      return snapshot.docs.map((doc): StalledTaskRow => {
        const data = doc.data()
        return {
          id: doc.id, status: String(data.status),
          currentStepOrder: Number(data.currentStepOrder ?? 0),
          currentStepDueAt: typeof data.currentStepDueAt === 'string' ? data.currentStepDueAt : null,
          currentStepEnteredAt: typeof data.currentStepEnteredAt === 'string' ? data.currentStepEnteredAt : null,
          currentStepStatus: typeof data.currentStepStatus === 'string' ? data.currentStepStatus : null,
          currentStepAssigneeDepartmentId: typeof data.currentStepAssigneeDepartmentId === 'string' ? data.currentStepAssigneeDepartmentId : null,
          departmentId: typeof data.departmentId === 'string' ? data.departmentId : null,
        }
      })
    },
  }
}

/** Active membership/employment filtering already happens downstream (NotificationProjectionService's
 * audience resolution checks organization_membership.status for every candidate id regardless of source —
 * see notification-audience.ts) so this only needs to return role holders, not re-filter them. */
export function createFirestoreEscalationRecipientPort(firestore: Firestore): EscalationRecipientPort {
  return {
    async activeDepartmentLeadIds(organizationId, departmentId) {
      const snapshot = await firestore.collection(tenantCollection(organizationId, 'role_assignment'))
        .where('roleId', '==', defaultRoleDocId('DepartmentLead'))
        .where('scopeType', '==', 'department').where('scopeId', '==', departmentId)
        .where('status', '==', 'active').where('effect', '==', 'grant')
        .limit(50).get()
      return snapshot.docs.map((doc) => String(doc.data().userId))
    },
    async activeOrgOwnerAndManagerIds(organizationId) {
      const roleIds = [defaultRoleDocId('Owner'), defaultRoleDocId('Manager')]
      const snapshot = await firestore.collection(tenantCollection(organizationId, 'role_assignment'))
        .where('roleId', 'in', roleIds).where('scopeType', '==', 'organization')
        .where('status', '==', 'active').where('effect', '==', 'grant')
        .limit(50).get()
      return snapshot.docs.map((doc) => String(doc.data().userId))
    },
  }
}
