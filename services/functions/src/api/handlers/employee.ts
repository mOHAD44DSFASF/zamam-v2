import { tenantCollectionPath } from '@zamam/firestore'
import { EmployeeService, type EmployeeLifecyclePort, type InvitationLookupPort } from '../../employee/service.js'
import { FirebaseEmployeeIdentityAdapter } from '../../employee/firebase-identity.js'
import type { Deps } from '../deps.js'
import { evaluateCapabilities, listQuery, orgPath, readDoc } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

function createInvitationLookupPort(deps: Deps): InvitationLookupPort {
  return {
    // Matches regardless of status/expiry — EmployeeService.acceptInvitation re-reads the record
    // authoritatively and distinguishes INVITATION_ALREADY_USED / INVITATION_EXPIRED / TOKEN_INVALID
    // itself, so those stay distinct, actionable error codes instead of one generic "not found".
    async findByTokenHash(tokenHash) {
      const snapshot = await deps.firestore.collectionGroup('invitation')
        .where('tokenHash', '==', tokenHash).limit(1).get()
      const doc = snapshot.docs[0]
      if (!doc) return null
      const organizationId = String(doc.data().organizationId ?? '')
      if (!organizationId) return null
      return { organizationId, invitationId: doc.id }
    },
  }
}

/** Shared with handlers/auth.ts, whose accept-invitation flow has no organization context yet and needs
 * the same EmployeeService instance/wiring rather than a second, divergent construction. */
export function createEmployeeService(deps: Deps): EmployeeService {
  return new EmployeeService(deps.store, deps.authorization, new FirebaseEmployeeIdentityAdapter(), createLifecyclePort(deps), createInvitationLookupPort(deps))
}

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
  const service = createEmployeeService(deps)

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
          employeeNumber: employment ? String(employment.employeeNumber ?? '') : '',
          jobTitle: employment ? String(employment.jobTitle) : null,
          employmentType: employment && employment.employmentType === 'contractor' ? 'contractor' as const : 'employee' as const,
          primaryDepartmentId: employment && typeof employment.primaryDepartmentId === 'string' ? employment.primaryDepartmentId : '',
          employmentStatus: employment ? String(employment.status) : null,
        }
      }))
      // Active departments — both to resolve row names and to populate the invite form's department picker.
      const departmentPage = await listQuery(deps, context.organizationId, 'department', {
        filters: [{ field: 'status', operator: '==', value: 'active' }],
        orderBy: [{ field: 'name', direction: 'asc' }], limit: 100,
      })
      const departments = departmentPage.items.map((d) => ({ id: String(d.id), name: String(d.name) }))
      const departmentNameById = new Map(departments.map((d) => [d.id, d.name]))
      const items = rows.map((r) => ({ ...r, departmentName: departmentNameById.get(r.primaryDepartmentId) ?? '' }))
      const capabilities = await evaluateCapabilities(deps, context.principal, context.organizationId, {
        invite: 'user.invite', update: 'user.update', disable: 'user.disable', viewHr: 'employment.view',
      })
      return { items, departments, capabilities }
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
