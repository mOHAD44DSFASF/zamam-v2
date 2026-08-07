import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AuthorizationPrincipal, AuthorizationRequest, DefaultRoleName, Permission } from '@zamam/authorization'
import { defaultRoleDocId } from '@zamam/authorization'
import {
  SCHEMA_VERSION,
  assertDateOnly,
  normalizeDirectoryName,
  normalizeEmail,
  normalizeEmployeeNumber,
  normalizeWhatsappPhone,
  type TenantEntityKind,
} from '@zamam/domain'
import {
  SERVER_TIMESTAMP,
  tenantDocumentPath,
  type AtomicStore,
  type AtomicTransaction,
  type StoredDocument,
} from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'
import { projectMembershipActive, projectMembershipInactive, sessionViewPath } from '../platform/session-view.js'

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const versionSchema = z.number().int().positive()
// Only the three roles this rollout actually needs are invite-time choices; the rest of the default-role
// catalog (Owner, GeneralManager, SystemAdministrator, ...) stays assignable only through the bootstrap
// flow or a future dedicated role-management surface — this is deliberately not a general RBAC UI.
const inviteRoleSchema = z.enum(['Employee', 'DepartmentLead', 'Manager'])
const inviteSchema = z.object({
  email: z.string().min(3).max(254),
  displayName: z.string().min(2).max(160),
  firstName: z.string().min(2).max(80),
  employeeNumber: z.string().min(2).max(32),
  employmentType: z.enum(['employee', 'contractor']),
  primaryDepartmentId: idSchema,
  jobTitle: z.string().min(2).max(120),
  managerUserId: idSchema.optional(),
  startDate: z.string(),
  locale: z.enum(['ar', 'en']).default('ar'),
  timezone: z.string().min(1).max(64),
  role: inviteRoleSchema.default('Employee'),
}).strict()

/** Employee -> self scope (visibility is per-assignment, see TaskService); DepartmentLead -> scoped to the
 * department they're being invited into (their "own department"); Manager -> organization-wide. This is
 * the entire "Manager can create tasks anywhere, DepartmentLead only in their department" distinction —
 * it lives in assignment SCOPE, not in a different permission set (see engine.ts scopeMatches()). */
const roleAssignmentScope = (role: z.infer<typeof inviteRoleSchema>, organizationId: string, userId: string, primaryDepartmentId: string) =>
  role === 'DepartmentLead'
    ? { scopeType: 'department' as const, scopeId: primaryDepartmentId }
    : role === 'Manager'
      ? { scopeType: 'organization' as const, scopeId: organizationId }
      : { scopeType: 'self' as const, scopeId: userId }

/** Direct member creation (Area 1): the creator supplies everything, the caller sees a strong temporary
 * password exactly once, and the new member is active immediately — no invitation/token/pending-acceptance
 * step. Same shape as inviteSchema plus the required whatsappPhone this rollout needs (see
 * domain/whatsapp.ts) since this account can never go through the profile-completion prompt shown to
 * pre-existing accounts. */
const createMemberSchema = z.object({
  email: z.string().min(3).max(254),
  displayName: z.string().min(2).max(160),
  firstName: z.string().min(2).max(80),
  employeeNumber: z.string().min(2).max(32),
  employmentType: z.enum(['employee', 'contractor']),
  primaryDepartmentId: idSchema,
  jobTitle: z.string().min(2).max(120),
  managerUserId: idSchema.optional(),
  startDate: z.string(),
  locale: z.enum(['ar', 'en']).default('ar'),
  timezone: z.string().min(1).max(64),
  role: inviteRoleSchema.default('Employee'),
  whatsappPhone: z.string().min(6).max(20),
}).strict()

const changePasswordSchema = z.object({
  newPassword: z.string().min(12).max(128),
}).strict()

const whatsappPhoneSchema = z.object({
  whatsappPhone: z.string().min(6).max(20),
}).strict()

const acceptInvitationSchema = z.object({
  invitationToken: z.string().regex(/^[A-Za-z0-9_-]{32,512}$/),
  password: z.string().min(12).max(128),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
}).strict()

const scheduleSchema = z.object({
  userId: idSchema,
  timezone: z.string().min(1).max(64),
  weeklyMinutes: z.number().int().min(0).max(10_080),
  effectiveFrom: z.string(),
  effectiveTo: z.string().optional(),
  expectedVersion: z.number().int().min(0),
}).strict()

export interface EmployeeAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}

export interface EmployeeCommandMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}

export interface EmployeeIdentityPort {
  provisionInvitation(input: {
    email: string
    displayName: string
    organizationId: string
    idempotencyKey: string
  }): Promise<{ userId: string; created: boolean }>
  compensateInvitation(userId: string, idempotencyKey: string): Promise<void>
  disableIdentity(userId: string): Promise<void>
  revokeRefreshTokens(userId: string): Promise<void>
  setPassword(userId: string, password: string): Promise<void>
}

/**
 * Locates a pending invitation by its token hash without knowing which organization it belongs to (the
 * public accept endpoint only receives the token) — same "resolve across all tenants by a system field,
 * then re-verify authoritatively inside the transaction" pattern already used for
 * hasOtherActiveMemberships (a collectionGroup lookup), not a new one.
 */
export interface InvitationLookupPort {
  findByTokenHash(tokenHash: string): Promise<{ organizationId: string; invitationId: string } | null>
}

export type EmployeeAccessReference = {
  kind: Extract<TenantEntityKind, 'role_assignment' | 'team_membership' | 'project_member'>
  id: string
  expectedVersion: number
}

interface AccessReferenceRevocationPlan {
  path: string
  update: StoredDocument
  dependents?: { path: string; update: StoredDocument }[]
}

export interface EmployeeLifecyclePort {
  isOwner(organizationId: string, userId: string): Promise<boolean>
  activeOwnerCount(organizationId: string): Promise<number>
  listActiveAccess(organizationId: string, userId: string): Promise<readonly EmployeeAccessReference[]>
  hasOtherActiveMemberships(userId: string, excludingOrganizationId: string): Promise<boolean>
}

const systemPath = (organizationId: string, collection: string, id: string) => {
  if (!/^[A-Za-z0-9_-]{2,128}$/.test(organizationId) || !/^[A-Za-z0-9_-]{2,128}$/.test(id)) throw new Error('INVALID_SYSTEM_RECORD_ID')
  return `v2Organizations/${organizationId}/${collection}/${id}`
}

const stableId = (prefix: string, value: string) =>
  `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`

const baseRecord = (organizationId: string) => ({
  organizationId,
  schemaVersion: SCHEMA_VERSION,
  version: 1,
  createdAt: SERVER_TIMESTAMP,
  updatedAt: SERVER_TIMESTAMP,
})

const readOwned = async (transaction: AtomicTransaction, path: string, organizationId: string) => {
  const record = await transaction.get(path)
  if (!record) throw new Error('ENTITY_NOT_FOUND')
  if (record.organizationId !== organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
  return record
}

const numeric = (value: unknown) => {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) throw new Error('INVALID_REFERENCE_COUNT')
  return number
}

const assertTokenMatches = (record: StoredDocument, tokenHash: string) => {
  const stored = Buffer.from(String(record.tokenHash ?? ''), 'hex')
  const provided = Buffer.from(tokenHash, 'hex')
  if (stored.length !== provided.length || !timingSafeEqual(stored, provided)) throw new Error('INVITATION_TOKEN_INVALID')
}

export class EmployeeService {
  private readonly audit: AuditCommandService

  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: EmployeeAuthorizationGate,
    private readonly identities: EmployeeIdentityPort,
    private readonly lifecycle: EmployeeLifecyclePort,
    private readonly invitations: InvitationLookupPort,
    audit?: AuditCommandService,
  ) {
    this.audit = audit ?? new AuditCommandService(store)
  }

  private async authorized(metadata: EmployeeCommandMetadata, permission: Permission, targetUserId?: string) {
    await this.authorization.require(metadata.principal, {
      permission,
      organizationId: metadata.organizationId,
      ...(targetUserId ? {
        resource: { type: 'user', id: targetUserId, organizationId: metadata.organizationId, ownerUserId: targetUserId },
      } : {}),
    })
    return {
      organizationId: metadata.organizationId,
      actorUserId: metadata.principal.userId,
      permission,
      correlationId: metadata.correlationId,
      idempotencyKey: metadata.idempotencyKey,
      fingerprint: metadata.fingerprint,
    }
  }

  async invite(metadata: EmployeeCommandMetadata, rawInput: z.input<typeof inviteSchema>) {
    const parsed = inviteSchema.parse(rawInput)
    const input = {
      ...parsed,
      email: normalizeEmail(parsed.email),
      displayName: normalizeDirectoryName(parsed.displayName),
      firstName: normalizeDirectoryName(parsed.firstName),
      employeeNumber: normalizeEmployeeNumber(parsed.employeeNumber),
      jobTitle: normalizeDirectoryName(parsed.jobTitle),
      startDate: assertDateOnly(parsed.startDate, 'INVALID_START_DATE'),
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format()
    } catch {
      throw new Error('INVALID_TIMEZONE')
    }
    const context = await this.authorized(metadata, 'user.invite')
    const identity = await this.identities.provisionInvitation({
      email: input.email,
      displayName: input.displayName,
      organizationId: metadata.organizationId,
      idempotencyKey: metadata.idempotencyKey,
    })
    idSchema.parse(identity.userId)
    const emailHash = createHash('sha256').update(input.email).digest('hex')
    const invitationId = stableId('invite', `${identity.userId}:${metadata.organizationId}`)
    // Same secure-token convention as password reset / R2 signed URLs: never persist the bearer secret
    // itself, only its SHA-256 hash; the plaintext is handed back once, here, for the inviter to deliver
    // (there is no outbound email adapter wired to production credentials yet).
    const invitationToken = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(invitationToken).digest('hex')
    const roleAssignmentId = `role-${identity.userId}`
    const roleId = defaultRoleDocId(input.role as DefaultRoleName)
    const rolePath = tenantDocumentPath(metadata.organizationId, 'role', roleId)
    try {
      return await this.audit.execute(context, async (transaction) => {
        const department = await readOwned(
          transaction,
          tenantDocumentPath(metadata.organizationId, 'department', input.primaryDepartmentId),
          metadata.organizationId,
        )
        if (department.status !== 'active') throw new Error('DEPARTMENT_NOT_ACTIVE')
        const role = await readOwned(transaction, rolePath, metadata.organizationId)
        if (role.status !== 'active') throw new Error('ROLE_NOT_ACTIVE')
        const emailIndexPath = systemPath(metadata.organizationId, '_memberEmailHashes', stableId('email', emailHash))
        if ((await transaction.get(emailIndexPath))?.active === true) throw new Error('EMAIL_ALREADY_MEMBER')
        const employeeIndexPath = systemPath(metadata.organizationId, '_employeeNumbers', stableId('employee', input.employeeNumber))
        if ((await transaction.get(employeeIndexPath))?.active === true) throw new Error('EMPLOYEE_NUMBER_ALREADY_EXISTS')
        const membershipPath = tenantDocumentPath(metadata.organizationId, 'organization_membership', identity.userId)
        if ((await transaction.get(membershipPath))?.status !== undefined) throw new Error('MEMBERSHIP_ALREADY_EXISTS')
        transaction.create(membershipPath, {
          ...baseRecord(metadata.organizationId), userId: identity.userId, status: 'invited', invitedAt: SERVER_TIMESTAMP,
        })
        transaction.create(tenantDocumentPath(metadata.organizationId, 'user_profile', identity.userId), {
          ...baseRecord(metadata.organizationId),
          userId: identity.userId,
          displayName: input.displayName,
          firstName: input.firstName,
          locale: input.locale,
          timezone: input.timezone,
        })
        transaction.create(tenantDocumentPath(metadata.organizationId, 'employment_profile', identity.userId), {
          ...baseRecord(metadata.organizationId),
          userId: identity.userId,
          employeeNumber: input.employeeNumber,
          employmentType: input.employmentType,
          primaryDepartmentId: input.primaryDepartmentId,
          jobTitle: input.jobTitle,
          ...(input.managerUserId ? { managerUserId: input.managerUserId } : {}),
          status: 'planned',
          startDate: input.startDate,
        })
        transaction.create(tenantDocumentPath(metadata.organizationId, 'invitation', invitationId), {
          ...baseRecord(metadata.organizationId),
          userId: identity.userId,
          emailHash,
          tokenHash,
          status: 'pending',
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        })
        transaction.create(emailIndexPath, { ...baseRecord(metadata.organizationId), active: true, userId: identity.userId })
        transaction.create(employeeIndexPath, { ...baseRecord(metadata.organizationId), active: true, userId: identity.userId })
        transaction.create(systemPath(metadata.organizationId, '_userAccessState', identity.userId), {
          ...baseRecord(metadata.organizationId), state: 'invited', userId: identity.userId,
        })
        const scope = roleAssignmentScope(input.role, metadata.organizationId, identity.userId, input.primaryDepartmentId)
        transaction.create(tenantDocumentPath(metadata.organizationId, 'role_assignment', roleAssignmentId), {
          ...baseRecord(metadata.organizationId), userId: identity.userId, roleId,
          scopeType: scope.scopeType, scopeId: scope.scopeId, effect: 'grant', status: 'active',
        })
        return {
          result: { userId: identity.userId, invitationId, invitationToken, membershipStatus: 'invited' as const },
          resourceType: 'organization_membership',
          resourceId: identity.userId,
          outbox: {
            type: 'user.invited',
            version: 1,
            payload: { userId: identity.userId, invitationId, organizationId: metadata.organizationId },
          },
        }
      })
    } catch (error) {
      if (identity.created) await this.identities.compensateInvitation(identity.userId, metadata.idempotencyKey)
      throw error
    }
  }

  /**
   * Direct member creation (Area 1) — Owner/Manager only (enforced by 'user.invite' not being in
   * DepartmentLead's permission set, see default-roles.ts departmentLead). Mirrors invite()'s
   * record-creation shape exactly (same collections, same fields) but skips the invitation/token/
   * pending-acceptance step entirely: the identity gets its password set immediately, membership and
   * employment go straight to 'active', and sessionViews is projected right away so the new member can log
   * in the moment this call returns. The temporary password is returned once, in plaintext, for the
   * creator to copy and deliver — never stored, never logged again after this.
   */
  async createDirect(metadata: EmployeeCommandMetadata, rawInput: z.input<typeof createMemberSchema>) {
    const parsed = createMemberSchema.parse(rawInput)
    const input = {
      ...parsed,
      email: normalizeEmail(parsed.email),
      displayName: normalizeDirectoryName(parsed.displayName),
      firstName: normalizeDirectoryName(parsed.firstName),
      employeeNumber: normalizeEmployeeNumber(parsed.employeeNumber),
      jobTitle: normalizeDirectoryName(parsed.jobTitle),
      startDate: assertDateOnly(parsed.startDate, 'INVALID_START_DATE'),
      whatsappPhone: normalizeWhatsappPhone(parsed.whatsappPhone),
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format()
    } catch {
      throw new Error('INVALID_TIMEZONE')
    }
    const context = await this.authorized(metadata, 'user.invite')
    const identity = await this.identities.provisionInvitation({
      email: input.email,
      displayName: input.displayName,
      organizationId: metadata.organizationId,
      idempotencyKey: metadata.idempotencyKey,
    })
    idSchema.parse(identity.userId)
    const temporaryPassword = randomBytes(18).toString('base64url')
    const emailHash = createHash('sha256').update(input.email).digest('hex')
    const roleAssignmentId = `role-${identity.userId}`
    const roleId = defaultRoleDocId(input.role as DefaultRoleName)
    const rolePath = tenantDocumentPath(metadata.organizationId, 'role', roleId)
    try {
      await this.identities.setPassword(identity.userId, temporaryPassword)
      return await this.audit.execute(context, async (transaction) => {
        const department = await readOwned(
          transaction,
          tenantDocumentPath(metadata.organizationId, 'department', input.primaryDepartmentId),
          metadata.organizationId,
        )
        if (department.status !== 'active') throw new Error('DEPARTMENT_NOT_ACTIVE')
        const role = await readOwned(transaction, rolePath, metadata.organizationId)
        if (role.status !== 'active') throw new Error('ROLE_NOT_ACTIVE')
        const emailIndexPath = systemPath(metadata.organizationId, '_memberEmailHashes', stableId('email', emailHash))
        if ((await transaction.get(emailIndexPath))?.active === true) throw new Error('EMAIL_ALREADY_MEMBER')
        const employeeIndexPath = systemPath(metadata.organizationId, '_employeeNumbers', stableId('employee', input.employeeNumber))
        if ((await transaction.get(employeeIndexPath))?.active === true) throw new Error('EMPLOYEE_NUMBER_ALREADY_EXISTS')
        const membershipPath = tenantDocumentPath(metadata.organizationId, 'organization_membership', identity.userId)
        if ((await transaction.get(membershipPath))?.status !== undefined) throw new Error('MEMBERSHIP_ALREADY_EXISTS')
        const existingSessionView = await transaction.get(sessionViewPath(identity.userId))
        transaction.create(membershipPath, {
          ...baseRecord(metadata.organizationId), userId: identity.userId, status: 'active', joinedAt: SERVER_TIMESTAMP,
        })
        transaction.create(tenantDocumentPath(metadata.organizationId, 'user_profile', identity.userId), {
          ...baseRecord(metadata.organizationId),
          userId: identity.userId,
          displayName: input.displayName,
          firstName: input.firstName,
          locale: input.locale,
          timezone: input.timezone,
          whatsappPhone: input.whatsappPhone,
        })
        transaction.create(tenantDocumentPath(metadata.organizationId, 'employment_profile', identity.userId), {
          ...baseRecord(metadata.organizationId),
          userId: identity.userId,
          employeeNumber: input.employeeNumber,
          employmentType: input.employmentType,
          primaryDepartmentId: input.primaryDepartmentId,
          jobTitle: input.jobTitle,
          ...(input.managerUserId ? { managerUserId: input.managerUserId } : {}),
          status: 'active',
          startDate: input.startDate,
          mustChangePassword: true,
        })
        transaction.create(emailIndexPath, { ...baseRecord(metadata.organizationId), active: true, userId: identity.userId })
        transaction.create(employeeIndexPath, { ...baseRecord(metadata.organizationId), active: true, userId: identity.userId })
        transaction.create(systemPath(metadata.organizationId, '_userAccessState', identity.userId), {
          ...baseRecord(metadata.organizationId), state: 'active', userId: identity.userId,
        })
        const scope = roleAssignmentScope(input.role, metadata.organizationId, identity.userId, input.primaryDepartmentId)
        transaction.create(tenantDocumentPath(metadata.organizationId, 'role_assignment', roleAssignmentId), {
          ...baseRecord(metadata.organizationId), userId: identity.userId, roleId,
          scopeType: scope.scopeType, scopeId: scope.scopeId, effect: 'grant', status: 'active',
        })
        projectMembershipActive(transaction, existingSessionView, {
          userId: identity.userId, organizationId: metadata.organizationId, displayName: input.displayName,
          email: input.email, mustChangePassword: true,
        })
        return {
          result: { userId: identity.userId, temporaryPassword, membershipStatus: 'active' as const },
          resourceType: 'organization_membership',
          resourceId: identity.userId,
          outbox: {
            type: 'user.activated',
            version: 1,
            payload: { userId: identity.userId, organizationId: metadata.organizationId },
          },
        }
      })
    } catch (error) {
      if (identity.created) await this.identities.compensateInvitation(identity.userId, metadata.idempotencyKey)
      throw error
    }
  }

  /**
   * Self-service, authenticated-by-session (not by a specific permission — every active member must be
   * able to change their own password, so there is deliberately no this.authorized() gate here, same as
   * acceptInvitation()'s pre-auth counterpart just below). Clears mustChangePassword so ProtectedRoute's
   * force-gate (see apps/web/src/auth/ProtectedRoute.tsx) lets the user through on their next session read.
   */
  async changeOwnPassword(metadata: EmployeeCommandMetadata, rawInput: z.input<typeof changePasswordSchema>) {
    const input = changePasswordSchema.parse(rawInput)
    const userId = metadata.principal.userId
    await this.identities.setPassword(userId, input.newPassword)
    const context = {
      organizationId: metadata.organizationId, actorUserId: userId, permission: 'user.update' as const,
      correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
    }
    return this.audit.execute(context, async (transaction) => {
      const employmentPath = tenantDocumentPath(metadata.organizationId, 'employment_profile', userId)
      const employment = await readOwned(transaction, employmentPath, metadata.organizationId)
      const existingSessionView = await transaction.get(sessionViewPath(userId))
      transaction.update(employmentPath, {
        mustChangePassword: false, version: numeric(employment.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      if (existingSessionView) {
        projectMembershipActive(transaction, existingSessionView, {
          userId, organizationId: metadata.organizationId,
          displayName: String(existingSessionView.displayName ?? ''), mustChangePassword: false,
        })
      }
      return {
        result: { userId, mustChangePassword: false },
        resourceType: 'employment_profile',
        resourceId: userId,
        outbox: { type: 'user.password_changed', version: 1, payload: { userId } },
      }
    })
  }

  /** Self-service profile field — any active member may set/update their own WhatsApp number (Area 5's
   * reminder links read it back). No RBAC gate for the same reason as changeOwnPassword(): this only ever
   * touches the caller's own record. */
  async updateOwnWhatsappPhone(metadata: EmployeeCommandMetadata, rawInput: z.input<typeof whatsappPhoneSchema>) {
    const input = whatsappPhoneSchema.parse(rawInput)
    const phone = normalizeWhatsappPhone(input.whatsappPhone)
    const userId = metadata.principal.userId
    const context = {
      organizationId: metadata.organizationId, actorUserId: userId, permission: 'user.update' as const,
      correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint,
    }
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'user_profile', userId)
      const profile = await readOwned(transaction, path, metadata.organizationId)
      transaction.update(path, { whatsappPhone: phone, version: numeric(profile.version) + 1, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { userId, whatsappPhone: phone },
        resourceType: 'user_profile',
        resourceId: userId,
        outbox: { type: 'user.profile_updated', version: 1, payload: { userId } },
      }
    })
  }

  /**
   * Self-service counterpart to invite(): authenticated by token possession (the caller has no Firebase
   * session yet), not by AuthorizationPrincipal/RBAC — the token itself is the credential, verified the
   * same way every other secret in this codebase is (SHA-256 hash comparison, never storing or logging
   * the plaintext) with a constant-time comparison since this path is reachable pre-authentication.
   */
  async acceptInvitation(input: {
    invitationToken: string
    password: string
    idempotencyKey: string
    correlationId: string
  }) {
    const parsed = acceptInvitationSchema.parse({
      invitationToken: input.invitationToken, password: input.password, idempotencyKey: input.idempotencyKey,
    })
    const tokenHash = createHash('sha256').update(parsed.invitationToken).digest('hex')
    const located = await this.invitations.findByTokenHash(tokenHash)
    if (!located) throw new Error('INVITATION_TOKEN_INVALID')
    const invitationPath = tenantDocumentPath(located.organizationId, 'invitation', located.invitationId)
    const preSnapshot = await this.store.runTransaction((transaction) => transaction.get(invitationPath))
    if (!preSnapshot) throw new Error('INVITATION_TOKEN_INVALID')
    assertTokenMatches(preSnapshot, tokenHash)
    if (preSnapshot.status !== 'pending') throw new Error('INVITATION_ALREADY_USED')
    if (Date.parse(String(preSnapshot.expiresAt)) <= Date.now()) throw new Error('INVITATION_EXPIRED')
    const userId = String(preSnapshot.userId)
    idSchema.parse(userId)

    const fingerprint = createHash('sha256').update(`${tokenHash}:${parsed.password}`).digest('hex')
    const context = {
      organizationId: located.organizationId,
      actorUserId: userId,
      permission: 'membership.manage' as const,
      correlationId: input.correlationId,
      idempotencyKey: parsed.idempotencyKey,
      fingerprint,
    }
    const replay = await this.audit.replay<{ userId: string; membershipStatus: 'active' }>(context)
    if (replay) return replay

    await this.identities.setPassword(userId, parsed.password)

    return this.audit.execute(context, async (transaction) => {
      const membershipPath = tenantDocumentPath(located.organizationId, 'organization_membership', userId)
      const employmentPath = tenantDocumentPath(located.organizationId, 'employment_profile', userId)
      const userProfilePath = tenantDocumentPath(located.organizationId, 'user_profile', userId)
      const statePath = systemPath(located.organizationId, '_userAccessState', userId)

      // Read phase — every get() must happen before any write() in a Firestore transaction.
      const invitation = await readOwned(transaction, invitationPath, located.organizationId)
      const membership = await readOwned(transaction, membershipPath, located.organizationId)
      const employment = await readOwned(transaction, employmentPath, located.organizationId)
      const userProfile = await readOwned(transaction, userProfilePath, located.organizationId)
      const state = await transaction.get(statePath)
      const existingSessionView = await transaction.get(sessionViewPath(userId))

      assertTokenMatches(invitation, tokenHash)
      if (invitation.userId !== userId) throw new Error('INVITATION_TOKEN_INVALID')
      if (invitation.status !== 'pending') throw new Error('INVITATION_ALREADY_USED')
      if (Date.parse(String(invitation.expiresAt)) <= Date.now()) throw new Error('INVITATION_EXPIRED')
      if (membership.status !== 'invited') throw new Error('MEMBERSHIP_NOT_INVITED')

      // Write phase.
      transaction.update(invitationPath, {
        status: 'accepted', acceptedAt: SERVER_TIMESTAMP,
        version: numeric(invitation.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      transaction.update(membershipPath, {
        status: 'active', joinedAt: SERVER_TIMESTAMP,
        version: numeric(membership.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      transaction.update(employmentPath, {
        status: 'active', version: numeric(employment.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      if (state) transaction.update(statePath, { state: 'active', version: numeric(state.version) + 1, updatedAt: SERVER_TIMESTAMP })
      projectMembershipActive(transaction, existingSessionView, {
        userId, organizationId: located.organizationId, displayName: String(userProfile.displayName ?? ''),
      })
      return {
        result: { userId, membershipStatus: 'active' as const },
        resourceType: 'organization_membership',
        resourceId: userId,
        outbox: { type: 'user.activated', version: 1, payload: { userId, organizationId: located.organizationId } },
      }
    })
  }

  async activateInvitation(metadata: EmployeeCommandMetadata, userId: string, expectedMembershipVersion: number) {
    idSchema.parse(userId)
    versionSchema.parse(expectedMembershipVersion)
    const context = await this.authorized(metadata, 'membership.manage', userId)
    return this.audit.execute(context, async (transaction) => {
      const membershipPath = tenantDocumentPath(metadata.organizationId, 'organization_membership', userId)
      const employmentPath = tenantDocumentPath(metadata.organizationId, 'employment_profile', userId)
      const userProfilePath = tenantDocumentPath(metadata.organizationId, 'user_profile', userId)
      const statePath = systemPath(metadata.organizationId, '_userAccessState', userId)

      const membership = await readOwned(transaction, membershipPath, metadata.organizationId)
      const employment = await readOwned(transaction, employmentPath, metadata.organizationId)
      const userProfile = await readOwned(transaction, userProfilePath, metadata.organizationId)
      const state = await transaction.get(statePath)
      const existingSessionView = await transaction.get(sessionViewPath(userId))

      if (membership.status !== 'invited') throw new Error('MEMBERSHIP_NOT_INVITED')
      if (membership.version !== expectedMembershipVersion) throw new Error('VERSION_CONFLICT')

      transaction.update(membershipPath, { status: 'active', joinedAt: SERVER_TIMESTAMP, version: expectedMembershipVersion + 1, updatedAt: SERVER_TIMESTAMP })
      transaction.update(employmentPath, { status: 'active', version: numeric(employment.version) + 1, updatedAt: SERVER_TIMESTAMP })
      if (state) transaction.update(statePath, { state: 'active', version: numeric(state.version) + 1, updatedAt: SERVER_TIMESTAMP })
      projectMembershipActive(transaction, existingSessionView, {
        userId, organizationId: metadata.organizationId, displayName: String(userProfile.displayName ?? ''),
      })
      return {
        result: { userId, status: 'active' as const },
        resourceType: 'organization_membership',
        resourceId: userId,
        outbox: { type: 'user.activated', version: 1, payload: { userId } },
      }
    })
  }

  async disable(metadata: EmployeeCommandMetadata, userId: string, expectedMembershipVersion: number, reason: string) {
    idSchema.parse(userId)
    versionSchema.parse(expectedMembershipVersion)
    if (metadata.principal.userId === userId) throw new Error('SELF_DISABLE_DENIED')
    const normalizedReason = reason.trim()
    if (normalizedReason.length < 10 || normalizedReason.length > 500) throw new Error('INVALID_DISABLE_REASON')
    const context = await this.authorized(metadata, 'user.disable', userId)
    if (await this.lifecycle.isOwner(metadata.organizationId, userId)
      && await this.lifecycle.activeOwnerCount(metadata.organizationId) <= 1) {
      throw new Error('LAST_OWNER_PROTECTED')
    }
    const result = await this.audit.execute(context, async (transaction) => {
      const membershipPath = tenantDocumentPath(metadata.organizationId, 'organization_membership', userId)
      const employmentPath = tenantDocumentPath(metadata.organizationId, 'employment_profile', userId)
      const statePath = systemPath(metadata.organizationId, '_userAccessState', userId)

      const membership = await readOwned(transaction, membershipPath, metadata.organizationId)
      const employment = await readOwned(transaction, employmentPath, metadata.organizationId)
      const state = await transaction.get(statePath)
      const existingSessionView = await transaction.get(sessionViewPath(userId))

      if (membership.status !== 'active') throw new Error('MEMBERSHIP_NOT_ACTIVE')
      if (membership.version !== expectedMembershipVersion) throw new Error('VERSION_CONFLICT')

      transaction.update(membershipPath, {
        status: 'suspended',
        suspensionReason: normalizedReason,
        suspendedBy: metadata.principal.userId,
        suspendedAt: SERVER_TIMESTAMP,
        version: expectedMembershipVersion + 1,
        updatedAt: SERVER_TIMESTAMP,
      })
      transaction.update(employmentPath, { status: 'suspended', version: numeric(employment.version) + 1, updatedAt: SERVER_TIMESTAMP })
      if (state) transaction.update(statePath, { state: 'disabled', version: numeric(state.version) + 1, updatedAt: SERVER_TIMESTAMP })
      projectMembershipInactive(transaction, existingSessionView, { userId, organizationId: metadata.organizationId })
      return {
        result: { userId, status: 'suspended' as const },
        resourceType: 'organization_membership',
        resourceId: userId,
        outbox: { type: 'user.disabled', version: 1, payload: { userId } },
      }
    })
    const hasOtherMemberships = await this.lifecycle.hasOtherActiveMemberships(userId, metadata.organizationId)
    const identityResults = await Promise.allSettled([
      ...(!hasOtherMemberships ? [this.identities.disableIdentity(userId)] : []),
      this.identities.revokeRefreshTokens(userId),
    ])
    if (identityResults.some(({ status }) => status === 'rejected')) throw new Error('IDENTITY_REVOCATION_PENDING')
    return result
  }

  async depart(metadata: EmployeeCommandMetadata, userId: string, expectedMembershipVersion: number, endDate: string, reason: string) {
    idSchema.parse(userId)
    versionSchema.parse(expectedMembershipVersion)
    const normalizedEndDate = assertDateOnly(endDate, 'INVALID_END_DATE')
    const normalizedReason = reason.trim()
    if (normalizedReason.length < 10 || normalizedReason.length > 500) throw new Error('INVALID_DEPARTURE_REASON')
    const context = await this.authorized(metadata, 'employment.manage', userId)
    if (await this.lifecycle.isOwner(metadata.organizationId, userId)
      && await this.lifecycle.activeOwnerCount(metadata.organizationId) <= 1) {
      throw new Error('LAST_OWNER_PROTECTED')
    }
    const references = await this.lifecycle.listActiveAccess(metadata.organizationId, userId)
    if (references.length > 400) throw new Error('DEPARTURE_REQUIRES_BATCH_WORKFLOW')
    const result = await this.audit.execute(context, async (transaction) => {
      const membershipPath = tenantDocumentPath(metadata.organizationId, 'organization_membership', userId)
      const employmentPath = tenantDocumentPath(metadata.organizationId, 'employment_profile', userId)
      const statePath = systemPath(metadata.organizationId, '_userAccessState', userId)

      // Read phase — including every access reference's own reads (each planAccessReferenceRevocation()
      // call only reads, never writes), all before any transaction.update()/create() below.
      const membership = await readOwned(transaction, membershipPath, metadata.organizationId)
      const employment = await readOwned(transaction, employmentPath, metadata.organizationId)
      const state = await transaction.get(statePath)
      const existingSessionView = await transaction.get(sessionViewPath(userId))
      const revocationPlans: AccessReferenceRevocationPlan[] = []
      for (const reference of references) {
        revocationPlans.push(await this.planAccessReferenceRevocation(transaction, metadata.organizationId, userId, reference))
      }

      if (!['active', 'suspended'].includes(String(membership.status))) throw new Error('MEMBERSHIP_NOT_DEPARTABLE')
      if (membership.version !== expectedMembershipVersion) throw new Error('VERSION_CONFLICT')
      if (!state) throw new Error('ACCESS_STATE_NOT_FOUND')

      // Write phase.
      transaction.update(statePath, { state: 'departed', version: numeric(state.version) + 1, updatedAt: SERVER_TIMESTAMP })
      transaction.update(membershipPath, {
        status: 'left', leftAt: SERVER_TIMESTAMP, version: expectedMembershipVersion + 1, updatedAt: SERVER_TIMESTAMP,
      })
      transaction.update(employmentPath, {
        status: 'ended', endDate: normalizedEndDate, endReason: normalizedReason,
        version: numeric(employment.version) + 1, updatedAt: SERVER_TIMESTAMP,
      })
      for (const plan of revocationPlans) this.applyAccessReferenceRevocation(transaction, plan)
      projectMembershipInactive(transaction, existingSessionView, { userId, organizationId: metadata.organizationId })
      return {
        result: { userId, status: 'left' as const, revokedAccessCount: references.length },
        resourceType: 'employment_profile',
        resourceId: userId,
        outbox: { type: 'employee.departed', version: 1, payload: { userId, revokedAccessCount: references.length } },
      }
    })
    const hasOtherMemberships = await this.lifecycle.hasOtherActiveMemberships(userId, metadata.organizationId)
    const identityResults = await Promise.allSettled([
      ...(!hasOtherMemberships ? [this.identities.disableIdentity(userId)] : []),
      this.identities.revokeRefreshTokens(userId),
    ])
    if (identityResults.some(({ status }) => status === 'rejected')) throw new Error('IDENTITY_REVOCATION_PENDING')
    return result
  }

  /**
   * Read-only: resolves everything needed to revoke one access reference (and, for team memberships, its
   * dependent counters) without issuing any writes — split from applyAccessReferenceRevocation() so a
   * caller can run this for every reference in the read phase, then apply every plan in the write phase.
   */
  private async planAccessReferenceRevocation(
    transaction: AtomicTransaction,
    organizationId: string,
    userId: string,
    reference: EmployeeAccessReference,
  ): Promise<AccessReferenceRevocationPlan> {
    idSchema.parse(reference.id)
    versionSchema.parse(reference.expectedVersion)
    const path = tenantDocumentPath(organizationId, reference.kind, reference.id)
    const record = await readOwned(transaction, path, organizationId)
    if (record.userId !== userId || record.version !== reference.expectedVersion) throw new Error('ACCESS_REFERENCE_CONFLICT')
    const version = reference.expectedVersion + 1
    if (reference.kind === 'role_assignment') {
      return { path, update: { status: 'revoked', revokedAt: SERVER_TIMESTAMP, version, updatedAt: SERVER_TIMESTAMP } }
    }
    const update: StoredDocument = { status: 'ended', endedAt: SERVER_TIMESTAMP, version, updatedAt: SERVER_TIMESTAMP }
    if (reference.kind !== 'team_membership') return { path, update }

    const teamId = String(record.teamId)
    const memberCountPath = systemPath(organizationId, '_teamActiveMemberCounts', teamId)
    const allocationPath = systemPath(organizationId, '_teamAllocationByUser', userId)
    const memberCount = await transaction.get(memberCountPath)
    const allocation = await transaction.get(allocationPath)
    const dependents: { path: string; update: StoredDocument }[] = []
    if (memberCount) dependents.push({ path: memberCountPath, update: { value: Math.max(0, numeric(memberCount.value) - 1), updatedAt: SERVER_TIMESTAMP } })
    if (allocation) dependents.push({
      path: allocationPath,
      update: { value: Math.max(0, numeric(allocation.value) - numeric(record.allocationPercent ?? 0)), updatedAt: SERVER_TIMESTAMP },
    })
    if (record.isPrimary === true) {
      const primaryPath = systemPath(organizationId, '_primaryTeamByUser', userId)
      const primary = await transaction.get(primaryPath)
      if (primary) dependents.push({ path: primaryPath, update: { active: false, updatedAt: SERVER_TIMESTAMP } })
    }
    return { path, update, dependents }
  }

  private applyAccessReferenceRevocation(transaction: AtomicTransaction, plan: AccessReferenceRevocationPlan) {
    transaction.update(plan.path, plan.update)
    for (const dependent of plan.dependents ?? []) transaction.update(dependent.path, dependent.update)
  }

  async upsertWorkSchedule(metadata: EmployeeCommandMetadata, rawInput: z.input<typeof scheduleSchema>) {
    const input = scheduleSchema.parse(rawInput)
    assertDateOnly(input.effectiveFrom, 'INVALID_EFFECTIVE_DATE')
    if (input.effectiveTo) {
      assertDateOnly(input.effectiveTo, 'INVALID_EFFECTIVE_DATE')
      if (input.effectiveTo < input.effectiveFrom) throw new Error('INVALID_EFFECTIVE_RANGE')
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format()
    } catch {
      throw new Error('INVALID_TIMEZONE')
    }
    const context = await this.authorized(metadata, 'work_schedule.manage', input.userId)
    return this.audit.execute(context, async (transaction) => {
      const employmentPath = tenantDocumentPath(metadata.organizationId, 'employment_profile', input.userId)
      const employment = await readOwned(transaction, employmentPath, metadata.organizationId)
      if (!['planned', 'active'].includes(String(employment.status))) throw new Error('EMPLOYMENT_NOT_SCHEDULABLE')
      const path = tenantDocumentPath(metadata.organizationId, 'work_schedule', input.userId)
      const existing = await transaction.get(path)
      if (!existing && input.expectedVersion !== 0) throw new Error('VERSION_CONFLICT')
      if (existing && existing.version !== input.expectedVersion) throw new Error('VERSION_CONFLICT')
      const version = input.expectedVersion + 1
      const values: StoredDocument = {
        userId: input.userId,
        timezone: input.timezone,
        weeklyMinutes: input.weeklyMinutes,
        effectiveFrom: input.effectiveFrom,
        ...(input.effectiveTo ? { effectiveTo: input.effectiveTo } : {}),
      }
      if (existing) transaction.update(path, { ...values, version, updatedAt: SERVER_TIMESTAMP })
      else transaction.create(path, { ...baseRecord(metadata.organizationId), ...values })
      transaction.update(employmentPath, {
        workScheduleId: input.userId,
        version: numeric(employment.version) + 1,
        updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { scheduleId: input.userId, version },
        resourceType: 'work_schedule',
        resourceId: input.userId,
        outbox: { type: 'work_schedule.updated', version: 1, payload: { userId: input.userId } },
      }
    })
  }
}
