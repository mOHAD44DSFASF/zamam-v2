import { tenantCollectionPath } from '@zamam/firestore'
import { EmployeeService, type EmployeeLifecyclePort } from '../../employee/service.js'
import { FirebaseEmployeeIdentityAdapter } from '../../employee/firebase-identity.js'
import type { Deps } from '../deps.js'
import { orgPath, readDoc } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

function createLifecyclePort(deps: Deps): EmployeeLifecyclePort {
  return {
    async isOwner(organizationId, userId) {
      const roles = await deps.firestore.collection(tenantCollectionPath(organizationId, 'role')).where('name', '==', 'Owner').get()
      if (roles.empty) return false
      const ownerRoleIds = new Set(roles.docs.map((doc) => doc.id))
      const assignments = await deps.firestore.collection(tenantCollectionPath(organizationId, 'role_assignment')).where('userId', '==', userId).get()
      return assignments.docs.some((doc) => {
        const data = doc.data()
        return data.status === 'active' && data.scopeType === 'organization' && ownerRoleIds.has(String(data.roleId))
      })
    },
    async activeOwnerCount(organizationId) {
      const roles = await deps.firestore.collection(tenantCollectionPath(organizationId, 'role')).where('name', '==', 'Owner').get()
      if (roles.empty) return 0
      const ownerRoleIds = new Set(roles.docs.map((doc) => doc.id))
      const assignments = await deps.firestore.collection(tenantCollectionPath(organizationId, 'role_assignment')).where('status', '==', 'active').get()
      return assignments.docs.filter((doc) => {
        const data = doc.data()
        return data.scopeType === 'organization' && ownerRoleIds.has(String(data.roleId))
      }).length
    },
    async listActiveAccess() { return [] },
    async hasOtherActiveMemberships(userId, excludingOrganizationId) {
      const snapshot = await deps.firestore.collectionGroup('organization_membership').where('userId', '==', userId).get()
      return snapshot.docs.some((doc) => {
        const data = doc.data()
        return data.status === 'active' && data.organizationId !== excludingOrganizationId
      })
    },
  }
}

export function createEmployeeHandlers(deps: Deps): HandlerRegistry {
  const identities = new FirebaseEmployeeIdentityAdapter()
  const lifecycle = createLifecyclePort(deps)
  const service = new EmployeeService(deps.store, deps.authorization, identities, lifecycle)

  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.invite>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/employees/query': async (context) => {
      await deps.authorization.require(context.principal, { permission: 'user.view', organizationId: context.organizationId })
      const memberships = await deps.firestore.collection(tenantCollectionPath(context.organizationId, 'organization_membership'))
        .where('status', 'in', ['invited', 'active', 'suspended']).limit(200).get()
      const rows = await Promise.all(memberships.docs.map(async (doc) => {
        const [profile, employment] = await Promise.all([
          readDoc(deps.firestore, orgPath(context.organizationId, 'user_profile', doc.id)),
          readDoc(deps.firestore, orgPath(context.organizationId, 'employment_profile', doc.id)),
        ])
        return {
          userId: doc.id, membershipStatus: doc.data().status,
          displayName: profile ? String(profile.displayName) : null,
          jobTitle: employment ? String(employment.jobTitle) : null,
          employmentStatus: employment ? String(employment.status) : null,
        }
      }))
      return { items: rows }
    },
    '/v1/employees/invite': (context, input) => service.invite(metadata(context), {
      email: requireString(input, 'email'), displayName: requireString(input, 'displayName'),
      firstName: requireString(input, 'firstName'), employeeNumber: requireString(input, 'employeeNumber'),
      employmentType: requireString(input, 'employmentType') as 'employee' | 'contractor',
      primaryDepartmentId: requireString(input, 'primaryDepartmentId'), jobTitle: requireString(input, 'jobTitle'),
      startDate: requireString(input, 'startDate'), timezone: requireString(input, 'timezone'),
      ...(typeof input.managerUserId === 'string' ? { managerUserId: input.managerUserId } : {}),
      ...(typeof input.locale === 'string' ? { locale: input.locale as 'ar' | 'en' } : {}),
    }),
    '/v1/employees/disable': (context, input) => service.disable(
      metadata(context), requireString(input, 'userId'), requireNumber(input, 'expectedMembershipVersion'), requireString(input, 'reason'),
    ),
  }
}
