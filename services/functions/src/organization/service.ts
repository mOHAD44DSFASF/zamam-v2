import { createHash } from 'node:crypto'
import type {
  AuthorizationPrincipal,
  AuthorizationRequest,
  Permission,
} from '@zamam/authorization'
import {
  SCHEMA_VERSION,
  assertAllocationPercent,
  assertCanArchiveDepartment,
  assertCanArchiveTeam,
  normalizeDirectoryCode,
  normalizeDirectoryName,
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

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const versionSchema = z.number().int().positive()
const memberSchema = z.object({
  teamId: idSchema,
  userId: idSchema,
  membershipRole: z.enum(['leader', 'member']),
  isPrimary: z.boolean(),
  allocationPercent: z.number().int().min(1).max(100).optional(),
}).strict()
const settingsSchema = z.object({
  timezone: z.string().min(1).max(64),
  locale: z.enum(['ar', 'en']),
  weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]),
  retentionPolicyId: idSchema,
  expectedVersion: z.number().int().min(0),
}).strict()

export interface OrganizationAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}

export interface OrganizationCommandMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}

export interface CreateDirectoryUnitInput {
  id: string
  name: string
  code: string
}

const systemPath = (organizationId: string, collection: string, id: string) => {
  if (!/^[A-Za-z0-9_-]{2,128}$/.test(organizationId) || !/^[A-Za-z0-9_-]{2,128}$/.test(id)) {
    throw new Error('INVALID_SYSTEM_RECORD_ID')
  }
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

const countValue = (record: StoredDocument | null) => {
  const value = record?.value ?? 0
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error('INVALID_REFERENCE_COUNT')
  return value as number
}

export class OrganizationStructureService {
  private readonly audit: AuditCommandService

  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: OrganizationAuthorizationGate,
    audit?: AuditCommandService,
  ) {
    this.audit = audit ?? new AuditCommandService(store)
  }

  private async authorized(metadata: OrganizationCommandMetadata, permission: Permission, resource: AuthorizationRequest['resource']) {
    await this.authorization.require(metadata.principal, {
      permission,
      organizationId: metadata.organizationId,
      ...(resource ? { resource } : {}),
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

  async updateOrganizationName(metadata: OrganizationCommandMetadata, rawName: string, expectedVersion: number) {
    const name = normalizeDirectoryName(rawName)
    versionSchema.parse(expectedVersion)
    const context = await this.authorized(metadata, 'organization.manage', {
      type: 'organization', id: metadata.organizationId, organizationId: metadata.organizationId,
    })
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'organization', metadata.organizationId)
      const organization = await readOwned(transaction, path, metadata.organizationId)
      if (organization.status !== 'active') throw new Error('ORGANIZATION_NOT_ACTIVE')
      if (organization.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      const version = expectedVersion + 1
      transaction.update(path, { name, version, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { organizationId: metadata.organizationId, version },
        resourceType: 'organization',
        resourceId: metadata.organizationId,
        outbox: { type: 'organization.updated', version: 1, payload: { organizationId: metadata.organizationId } },
      }
    })
  }

  async updateSettings(metadata: OrganizationCommandMetadata, rawInput: z.input<typeof settingsSchema>) {
    const input = settingsSchema.parse(rawInput)
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format()
    } catch {
      throw new Error('INVALID_TIMEZONE')
    }
    const context = await this.authorized(metadata, 'settings.manage', {
      type: 'organization', id: metadata.organizationId, organizationId: metadata.organizationId,
    })
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'organization_settings', 'default')
      const existing = await transaction.get(path)
      if (existing && existing.organizationId !== metadata.organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
      if (!existing && input.expectedVersion !== 0) throw new Error('VERSION_CONFLICT')
      if (existing && existing.version !== input.expectedVersion) throw new Error('VERSION_CONFLICT')
      const version = input.expectedVersion + 1
      const values = {
        timezone: input.timezone,
        locale: input.locale,
        weekStartsOn: input.weekStartsOn,
        retentionPolicyId: input.retentionPolicyId,
      }
      if (existing) transaction.update(path, { ...values, version, updatedAt: SERVER_TIMESTAMP })
      else transaction.create(path, { ...baseRecord(metadata.organizationId), ...values })
      return {
        result: { settingsId: 'default', version },
        resourceType: 'organization_settings',
        resourceId: 'default',
        outbox: { type: 'organization.settings_updated', version: 1, payload: { organizationId: metadata.organizationId } },
      }
    })
  }

  async suspendOrganization(metadata: OrganizationCommandMetadata, expectedVersion: number, reason: string) {
    versionSchema.parse(expectedVersion)
    const normalizedReason = reason.trim()
    if (normalizedReason.length < 10 || normalizedReason.length > 500) throw new Error('INVALID_SUSPENSION_REASON')
    const context = await this.authorized(metadata, 'organization.suspend', {
      type: 'organization', id: metadata.organizationId, organizationId: metadata.organizationId,
    })
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'organization', metadata.organizationId)
      const organization = await readOwned(transaction, path, metadata.organizationId)
      if (organization.status !== 'active') throw new Error('ORGANIZATION_NOT_ACTIVE')
      if (organization.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      const version = expectedVersion + 1
      transaction.update(path, {
        status: 'suspended',
        suspensionReason: normalizedReason,
        suspendedBy: metadata.principal.userId,
        suspendedAt: SERVER_TIMESTAMP,
        version,
        updatedAt: SERVER_TIMESTAMP,
      })
      return {
        result: { organizationId: metadata.organizationId, version, status: 'suspended' as const },
        resourceType: 'organization',
        resourceId: metadata.organizationId,
        outbox: { type: 'organization.suspended', version: 1, payload: { organizationId: metadata.organizationId } },
      }
    })
  }

  async createDepartment(metadata: OrganizationCommandMetadata, rawInput: CreateDirectoryUnitInput) {
    const input = {
      id: idSchema.parse(rawInput.id),
      name: normalizeDirectoryName(rawInput.name),
      code: normalizeDirectoryCode(rawInput.code),
    }
    const context = await this.authorized(metadata, 'department.create', {
      type: 'department', id: input.id, organizationId: metadata.organizationId,
    })
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'department', input.id)
      const uniquePath = systemPath(metadata.organizationId, '_uniqueDepartmentCodes', stableId('department', input.code))
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      const unique = await transaction.get(uniquePath)
      if (unique?.active === true) throw new Error('DEPARTMENT_CODE_ALREADY_EXISTS')
      transaction.create(path, { ...baseRecord(metadata.organizationId), ...input, status: 'active' })
      if (unique) transaction.update(uniquePath, { active: true, entityId: input.id, updatedAt: SERVER_TIMESTAMP })
      else transaction.create(uniquePath, { ...baseRecord(metadata.organizationId), active: true, entityId: input.id, normalizedCode: input.code })
      return {
        result: { departmentId: input.id, version: 1 },
        resourceType: 'department',
        resourceId: input.id,
        outbox: { type: 'department.created', version: 1, payload: { departmentId: input.id } },
      }
    })
  }

  async archiveDepartment(metadata: OrganizationCommandMetadata, departmentId: string, expectedVersion: number) {
    idSchema.parse(departmentId)
    versionSchema.parse(expectedVersion)
    const context = await this.authorized(metadata, 'department.archive', {
      type: 'department', id: departmentId, organizationId: metadata.organizationId, departmentId,
    })
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'department', departmentId)
      const department = await readOwned(transaction, path, metadata.organizationId)
      if (department.status !== 'active') throw new Error('DEPARTMENT_NOT_ACTIVE')
      if (department.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      // Read phase — all get()s before any write (Firestore transaction rule).
      const teamCounter = await transaction.get(systemPath(metadata.organizationId, '_departmentActiveTeamCounts', departmentId))
      const uniquePath = systemPath(metadata.organizationId, '_uniqueDepartmentCodes', stableId('department', String(department.code)))
      const unique = await transaction.get(uniquePath)
      assertCanArchiveDepartment(countValue(teamCounter))
      const version = expectedVersion + 1
      // Write phase.
      transaction.update(path, { status: 'archived', deletedAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP, version })
      if (unique) transaction.update(uniquePath, { active: false, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { departmentId, version },
        resourceType: 'department',
        resourceId: departmentId,
        outbox: { type: 'department.archived', version: 1, payload: { departmentId } },
      }
    })
  }

  async createTeam(metadata: OrganizationCommandMetadata, departmentId: string, rawInput: CreateDirectoryUnitInput) {
    idSchema.parse(departmentId)
    const input = {
      id: idSchema.parse(rawInput.id),
      name: normalizeDirectoryName(rawInput.name),
      code: normalizeDirectoryCode(rawInput.code),
    }
    const context = await this.authorized(metadata, 'team.create', {
      type: 'team', id: input.id, organizationId: metadata.organizationId, departmentId,
    })
    return this.audit.execute(context, async (transaction) => {
      const department = await readOwned(transaction, tenantDocumentPath(metadata.organizationId, 'department', departmentId), metadata.organizationId)
      if (department.status !== 'active') throw new Error('DEPARTMENT_NOT_ACTIVE')
      // Read phase — all get()s before any write (Firestore transaction rule).
      const path = tenantDocumentPath(metadata.organizationId, 'team', input.id)
      const existingTeam = await transaction.get(path)
      const uniquePath = systemPath(metadata.organizationId, '_uniqueTeamCodes', stableId('team', input.code))
      const unique = await transaction.get(uniquePath)
      const countPath = systemPath(metadata.organizationId, '_departmentActiveTeamCounts', departmentId)
      const counter = await transaction.get(countPath)
      if (existingTeam) throw new Error('ENTITY_ALREADY_EXISTS')
      if (unique?.active === true) throw new Error('TEAM_CODE_ALREADY_EXISTS')
      const value = countValue(counter) + 1
      // Write phase.
      transaction.create(path, { ...baseRecord(metadata.organizationId), ...input, departmentId, status: 'active' })
      if (unique) transaction.update(uniquePath, { active: true, entityId: input.id, updatedAt: SERVER_TIMESTAMP })
      else transaction.create(uniquePath, { ...baseRecord(metadata.organizationId), active: true, entityId: input.id, normalizedCode: input.code })
      if (counter) transaction.update(countPath, { value, updatedAt: SERVER_TIMESTAMP })
      else transaction.create(countPath, { ...baseRecord(metadata.organizationId), value })
      return {
        result: { teamId: input.id, version: 1 },
        resourceType: 'team',
        resourceId: input.id,
        outbox: { type: 'team.created', version: 1, payload: { teamId: input.id, departmentId } },
      }
    })
  }

  async archiveTeam(metadata: OrganizationCommandMetadata, teamId: string, expectedVersion: number) {
    idSchema.parse(teamId)
    versionSchema.parse(expectedVersion)
    const context = await this.authorized(metadata, 'team.archive', {
      type: 'team', id: teamId, organizationId: metadata.organizationId, teamId,
    })
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'team', teamId)
      const team = await readOwned(transaction, path, metadata.organizationId)
      if (team.status !== 'active') throw new Error('TEAM_NOT_ACTIVE')
      if (team.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      // Read phase — all get()s before any write (Firestore transaction rule).
      const memberCounter = await transaction.get(systemPath(metadata.organizationId, '_teamActiveMemberCounts', teamId))
      const uniquePath = systemPath(metadata.organizationId, '_uniqueTeamCodes', stableId('team', String(team.code)))
      const unique = await transaction.get(uniquePath)
      const countPath = systemPath(metadata.organizationId, '_departmentActiveTeamCounts', String(team.departmentId))
      const counter = await transaction.get(countPath)
      assertCanArchiveTeam(countValue(memberCounter))
      const version = expectedVersion + 1
      const value = Math.max(0, countValue(counter) - 1)
      // Write phase.
      transaction.update(path, { status: 'archived', deletedAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP, version })
      if (unique) transaction.update(uniquePath, { active: false, updatedAt: SERVER_TIMESTAMP })
      if (counter) transaction.update(countPath, { value, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { teamId, version },
        resourceType: 'team',
        resourceId: teamId,
        outbox: { type: 'team.archived', version: 1, payload: { teamId } },
      }
    })
  }

  async addTeamMember(metadata: OrganizationCommandMetadata, rawInput: z.input<typeof memberSchema>) {
    const input = memberSchema.parse(rawInput)
    assertAllocationPercent(input.allocationPercent)
    const context = await this.authorized(metadata, 'team.manage', {
      type: 'team', id: input.teamId, organizationId: metadata.organizationId, teamId: input.teamId,
    })
    return this.audit.execute(context, async (transaction) => {
      // Read phase — all get()s before any write (Firestore transaction rule).
      const team = await readOwned(transaction, tenantDocumentPath(metadata.organizationId, 'team', input.teamId), metadata.organizationId)
      const membershipId = stableId('membership', `${input.teamId}:${input.userId}`)
      const path = tenantDocumentPath(metadata.organizationId, 'team_membership', membershipId)
      const existing = await transaction.get(path)
      const allocationPath = systemPath(metadata.organizationId, '_teamAllocationByUser', input.userId)
      const allocation = await transaction.get(allocationPath)
      const primaryPath = systemPath(metadata.organizationId, '_primaryTeamByUser', input.userId)
      const primary = input.isPrimary ? await transaction.get(primaryPath) : null
      const memberCountPath = systemPath(metadata.organizationId, '_teamActiveMemberCounts', input.teamId)
      const memberCount = await transaction.get(memberCountPath)

      if (team.status !== 'active') throw new Error('TEAM_NOT_ACTIVE')
      if (existing?.status === 'active') throw new Error('TEAM_MEMBERSHIP_ALREADY_ACTIVE')
      const nextAllocation = countValue(allocation) + (input.allocationPercent ?? 0)
      if (nextAllocation > 100) throw new Error('TEAM_ALLOCATION_EXCEEDED')
      if (input.isPrimary && primary?.active === true && primary.teamId !== input.teamId) throw new Error('PRIMARY_TEAM_ALREADY_ASSIGNED')
      const value = countValue(memberCount) + 1

      // Write phase.
      if (input.isPrimary) {
        if (primary) transaction.update(primaryPath, { active: true, teamId: input.teamId, updatedAt: SERVER_TIMESTAMP })
        else transaction.create(primaryPath, { ...baseRecord(metadata.organizationId), active: true, teamId: input.teamId, userId: input.userId })
      }
      const record = { ...baseRecord(metadata.organizationId), ...input, status: 'active' }
      if (existing) transaction.update(path, { ...input, status: 'active', deletedAt: null, version: Number(existing.version) + 1, updatedAt: SERVER_TIMESTAMP })
      else transaction.create(path, record)
      if (memberCount) transaction.update(memberCountPath, { value, updatedAt: SERVER_TIMESTAMP })
      else transaction.create(memberCountPath, { ...baseRecord(metadata.organizationId), value })
      if (allocation) transaction.update(allocationPath, { value: nextAllocation, updatedAt: SERVER_TIMESTAMP })
      else transaction.create(allocationPath, { ...baseRecord(metadata.organizationId), value: nextAllocation })
      return {
        result: { membershipId, version: existing ? Number(existing.version) + 1 : 1 },
        resourceType: 'team_membership',
        resourceId: membershipId,
        outbox: { type: 'team.member_added', version: 1, payload: { membershipId, teamId: input.teamId, userId: input.userId } },
      }
    })
  }

  async endTeamMember(metadata: OrganizationCommandMetadata, teamId: string, userId: string, expectedVersion: number) {
    idSchema.parse(teamId)
    idSchema.parse(userId)
    versionSchema.parse(expectedVersion)
    const context = await this.authorized(metadata, 'team.manage', {
      type: 'team', id: teamId, organizationId: metadata.organizationId, teamId,
    })
    return this.audit.execute(context, async (transaction) => {
      const membershipId = stableId('membership', `${teamId}:${userId}`)
      const path = tenantDocumentPath(metadata.organizationId, 'team_membership', membershipId)
      const membership = await readOwned(transaction, path, metadata.organizationId)
      if (membership.status !== 'active') throw new Error('TEAM_MEMBERSHIP_NOT_ACTIVE')
      if (membership.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      const version = expectedVersion + 1
      // Read phase — all get()s before any write (Firestore transaction rule).
      const memberCountPath = systemPath(metadata.organizationId, '_teamActiveMemberCounts', teamId)
      const memberCount = await transaction.get(memberCountPath)
      const allocationPath = systemPath(metadata.organizationId, '_teamAllocationByUser', userId)
      const allocation = await transaction.get(allocationPath)
      const primaryPath = systemPath(metadata.organizationId, '_primaryTeamByUser', userId)
      const primary = membership.isPrimary === true ? await transaction.get(primaryPath) : null
      // Write phase.
      transaction.update(path, { status: 'ended', endedAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP, version })
      if (memberCount) transaction.update(memberCountPath, { value: Math.max(0, countValue(memberCount) - 1), updatedAt: SERVER_TIMESTAMP })
      if (allocation) transaction.update(allocationPath, {
        value: Math.max(0, countValue(allocation) - Number(membership.allocationPercent ?? 0)),
        updatedAt: SERVER_TIMESTAMP,
      })
      if (membership.isPrimary === true && primary) transaction.update(primaryPath, { active: false, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { membershipId, version },
        resourceType: 'team_membership',
        resourceId: membershipId,
        outbox: { type: 'team.member_ended', version: 1, payload: { membershipId, teamId, userId } },
      }
    })
  }
}
