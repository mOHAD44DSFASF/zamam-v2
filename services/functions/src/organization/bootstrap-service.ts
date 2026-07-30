import { createDefaultRoles } from '@zamam/authorization'
import { SCHEMA_VERSION, normalizeDirectoryName, normalizeEmail } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore } from '@zamam/firestore'
import { z } from 'zod'

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const bootstrapSchema = z.object({
  organizationId: idSchema,
  organizationName: z.string().min(2).max(160),
  organizationSlug: z.string().regex(/^[a-z0-9-]{2,64}$/),
  ownerEmail: z.string().min(3).max(254),
  ownerDisplayName: z.string().min(2).max(160),
  ownerFirstName: z.string().min(2).max(80),
  ownerPassword: z.string().min(12).max(128).optional(),
  timezone: z.string().min(1).max(64).default('Asia/Riyadh'),
  locale: z.enum(['ar', 'en']).default('ar'),
}).strict()

export type BootstrapOwnerInput = z.input<typeof bootstrapSchema>

/** Same get-or-create + set-password contract EmployeeService already uses (FirebaseEmployeeIdentityAdapter
 * implements both), reused rather than re-invented for the bootstrap CLI. */
export interface OwnerIdentityPort {
  provisionInvitation(input: {
    email: string
    displayName: string
    organizationId: string
    idempotencyKey: string
  }): Promise<{ userId: string; created: boolean }>
  setPassword(userId: string, password: string): Promise<void>
}

export interface BootstrapOwnerActions {
  organizationCreated: boolean
  departmentCreated: boolean
  membershipCreated: boolean
  employmentCreated: boolean
  roleCreated: boolean
  roleAssignmentCreated: boolean
  sessionViewCreated: boolean
  passwordSet: boolean
}

export interface BootstrapOwnerResult {
  organizationId: string
  userId: string
  departmentId: string
  roleId: string
  roleAssignmentId: string
  actions: BootstrapOwnerActions
}

const ROOT_DEPARTMENT_ID = 'root'
const OWNER_ROLE_ID = 'default-owner'

const base = (organizationId: string) => ({
  organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
  createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
})

/**
 * Creates (or completes) the first Owner and their organization. This is the one place in the system
 * allowed to grant Owner without going through the normal invite → accept flow, because before this
 * runs there is no organization, no membership, and no role to authorize against — it is a cold-start
 * operation, not a trusted API command. Every write is check-then-create, so running this twice with the
 * same organizationId/ownerEmail never duplicates or corrupts state; it just finishes whatever a prior
 * run left incomplete.
 */
export class BootstrapOwnerService {
  constructor(
    private readonly store: AtomicStore,
    private readonly identities: OwnerIdentityPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async bootstrap(raw: BootstrapOwnerInput): Promise<BootstrapOwnerResult> {
    const input = bootstrapSchema.parse(raw)
    const email = normalizeEmail(input.ownerEmail)
    const displayName = normalizeDirectoryName(input.ownerDisplayName)

    const identity = await this.identities.provisionInvitation({
      email, displayName, organizationId: input.organizationId,
      idempotencyKey: `bootstrap-${input.organizationId}`,
    })
    let passwordSet = false
    if (input.ownerPassword) {
      await this.identities.setPassword(identity.userId, input.ownerPassword)
      passwordSet = true
    }

    const ownerRole = createDefaultRoles(input.organizationId).Owner
    const roleAssignmentId = `owner-${identity.userId}`
    const startDate = this.now().toISOString().slice(0, 10)

    const actions = await this.store.runTransaction(async (transaction) => {
      // Firestore transactions require every read to happen before any write, so every existence
      // check is resolved first (phase 1) and every transaction.create() call happens afterward
      // (phase 2) — never interleaved per-entity.
      const organizationPath = tenantDocumentPath(input.organizationId, 'organization', input.organizationId)
      const departmentPath = tenantDocumentPath(input.organizationId, 'department', ROOT_DEPARTMENT_ID)
      const membershipPath = tenantDocumentPath(input.organizationId, 'organization_membership', identity.userId)
      const employmentPath = tenantDocumentPath(input.organizationId, 'employment_profile', identity.userId)
      const profilePath = tenantDocumentPath(input.organizationId, 'user_profile', identity.userId)
      const rolePath = tenantDocumentPath(input.organizationId, 'role', OWNER_ROLE_ID)
      const assignmentPath = tenantDocumentPath(input.organizationId, 'role_assignment', roleAssignmentId)
      // sessionViews is a top-level (non-tenant) read model the web app's AuthProvider reads directly from
      // Firestore to gate ProtectedRoute — see apps/web/src/auth/session-reader.ts. No production code
      // currently maintains it for any user (there is no invite/accept/disable writer either — tracked as
      // remaining P4/P5 work in docs/v2/AUTH_LIFECYCLE_AND_THREAT_MODEL.md); bootstrap must write its own
      // entry directly or the owner it just created can never pass ProtectedRoute's account/membership check.
      const sessionViewPath = `sessionViews/${identity.userId}`

      const existingOrganization = await transaction.get(organizationPath)
      const existingDepartment = await transaction.get(departmentPath)
      const existingMembership = await transaction.get(membershipPath)
      const existingEmployment = await transaction.get(employmentPath)
      const existingProfile = await transaction.get(profilePath)
      const existingRole = await transaction.get(rolePath)
      const existingAssignment = await transaction.get(assignmentPath)
      const existingSessionView = await transaction.get(sessionViewPath)

      const result: BootstrapOwnerActions = {
        organizationCreated: false, departmentCreated: false, membershipCreated: false,
        employmentCreated: false, roleCreated: false, roleAssignmentCreated: false,
        sessionViewCreated: false, passwordSet,
      }

      if (!existingOrganization) {
        transaction.create(organizationPath, {
          ...base(input.organizationId), name: normalizeDirectoryName(input.organizationName),
          slug: input.organizationSlug, status: 'active',
        })
        result.organizationCreated = true
      }

      if (!existingDepartment) {
        transaction.create(departmentPath, {
          ...base(input.organizationId), name: 'Executive', code: 'ROOT', status: 'active',
        })
        result.departmentCreated = true
      }

      if (!existingMembership) {
        transaction.create(membershipPath, {
          ...base(input.organizationId), userId: identity.userId, status: 'active',
          invitedAt: SERVER_TIMESTAMP, joinedAt: SERVER_TIMESTAMP,
        })
        result.membershipCreated = true
      }

      if (!existingEmployment) {
        transaction.create(employmentPath, {
          ...base(input.organizationId), userId: identity.userId, employeeNumber: 'OWNER-1',
          employmentType: 'employee', primaryDepartmentId: ROOT_DEPARTMENT_ID, jobTitle: 'Owner',
          status: 'active', startDate,
        })
        result.employmentCreated = true
      }

      if (!existingProfile) {
        transaction.create(profilePath, {
          ...base(input.organizationId), userId: identity.userId, displayName,
          firstName: normalizeDirectoryName(input.ownerFirstName), locale: input.locale, timezone: input.timezone,
        })
      }

      if (!existingRole) {
        transaction.create(rolePath, {
          ...base(input.organizationId), name: ownerRole.name,
          permissions: ownerRole.permissions, policyVersion: ownerRole.policyVersion, status: 'active',
        })
        result.roleCreated = true
      }

      if (!existingAssignment) {
        transaction.create(assignmentPath, {
          ...base(input.organizationId), userId: identity.userId, roleId: OWNER_ROLE_ID,
          scopeType: 'organization', scopeId: input.organizationId, effect: 'grant', status: 'active',
        })
        result.roleAssignmentCreated = true
      }

      if (!existingSessionView) {
        transaction.create(sessionViewPath, {
          userId: identity.userId, displayName, email, accountStatus: 'active',
          memberships: [{ organizationId: input.organizationId, status: 'active' }],
        })
        result.sessionViewCreated = true
      }

      return result
    })

    return {
      organizationId: input.organizationId, userId: identity.userId,
      departmentId: ROOT_DEPARTMENT_ID, roleId: OWNER_ROLE_ID, roleAssignmentId, actions,
    }
  }
}
