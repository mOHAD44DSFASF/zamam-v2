import { createHash } from 'node:crypto'
import type { AuthorizationPrincipal, AuthorizationRequest, Permission } from '@zamam/authorization'
import {
  SCHEMA_VERSION,
  assertCanArchiveClient,
  assertClientStatusTransition,
  normalizeClientCode,
  normalizeClientName,
  normalizeEmail,
} from '@zamam/domain'
import {
  SERVER_TIMESTAMP,
  tenantDocumentPath,
  type AtomicStore,
  type AtomicTransaction,
} from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const versionSchema = z.number().int().positive()
const clientSchema = z.object({
  id: idSchema,
  name: z.string().min(2).max(160),
  code: z.string().min(2).max(32),
  industry: z.string().min(2).max(100).optional(),
  accountManagerUserId: idSchema.optional(),
}).strict()
const contactSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  name: z.string().min(2).max(160),
  email: z.string().min(3).max(254),
  clientAdmin: z.boolean().default(false),
}).strict()

export interface ClientAuthorizationGate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}

export interface ClientCommandMetadata {
  organizationId: string
  principal: AuthorizationPrincipal
  correlationId: string
  idempotencyKey: string
  fingerprint: string
}

export interface ClientDataProtectionPort {
  protectEmail(input: {
    organizationId: string
    clientId: string
    normalizedEmail: string
  }): Promise<{ deterministicHash: string; ciphertext: string; keyVersion: string }>
  revealEmail(input: {
    organizationId: string
    clientId: string
    ciphertext: string
    keyVersion: string
  }): Promise<string>
}

export interface ClientContactReference {
  id: string
  expectedVersion: number
  userId?: string
}

export interface ClientLifecyclePort {
  listContacts(organizationId: string, clientId: string): Promise<readonly ClientContactReference[]>
  revokePortalIdentity(userId: string): Promise<void>
}

const systemPath = (organizationId: string, collection: string, id: string) => {
  if (!/^[A-Za-z0-9_-]{2,128}$/.test(organizationId) || !/^[A-Za-z0-9_-]{2,128}$/.test(id)) throw new Error('INVALID_SYSTEM_RECORD_ID')
  return `v2Organizations/${organizationId}/${collection}/${id}`
}
const stableId = (prefix: string, value: string) => `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`
const baseRecord = (organizationId: string) => ({
  organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
  createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
})
const readOwned = async (transaction: AtomicTransaction, path: string, organizationId: string) => {
  const record = await transaction.get(path)
  if (!record) throw new Error('ENTITY_NOT_FOUND')
  if (record.organizationId !== organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
  return record
}
const count = (record: Readonly<Record<string, unknown>> | null) => {
  const value = Number(record?.value ?? 0)
  if (!Number.isInteger(value) || value < 0) throw new Error('INVALID_REFERENCE_COUNT')
  return value
}

export class ClientService {
  private readonly audit: AuditCommandService
  constructor(
    private readonly store: AtomicStore,
    private readonly authorization: ClientAuthorizationGate,
    private readonly protection: ClientDataProtectionPort,
    private readonly lifecycle: ClientLifecyclePort,
    audit?: AuditCommandService,
  ) {
    this.audit = audit ?? new AuditCommandService(store)
  }

  private async authorized(metadata: ClientCommandMetadata, permission: Permission, clientId?: string) {
    await this.authorization.require(metadata.principal, {
      permission,
      organizationId: metadata.organizationId,
      ...(clientId ? {
        resource: {
          type: 'client',
          id: clientId,
          organizationId: metadata.organizationId,
          clientAccountId: clientId,
          visibility: 'internal',
        },
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

  async create(metadata: ClientCommandMetadata, rawInput: z.input<typeof clientSchema>) {
    const parsed = clientSchema.parse(rawInput)
    const input = {
      ...parsed,
      name: normalizeClientName(parsed.name),
      code: normalizeClientCode(parsed.code),
      ...(parsed.industry ? { industry: normalizeClientName(parsed.industry) } : {}),
    }
    const context = await this.authorized(metadata, 'client.create', input.id)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'client', input.id)
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      const uniquePath = systemPath(metadata.organizationId, '_uniqueClientCodes', stableId('client', input.code))
      if ((await transaction.get(uniquePath))?.active === true) throw new Error('CLIENT_CODE_ALREADY_EXISTS')
      transaction.create(path, { ...baseRecord(metadata.organizationId), ...input, status: 'lead' })
      transaction.create(uniquePath, { ...baseRecord(metadata.organizationId), active: true, clientId: input.id, normalizedCode: input.code })
      return {
        result: { clientId: input.id, version: 1, status: 'lead' as const },
        resourceType: 'client',
        resourceId: input.id,
        outbox: { type: 'client.created', version: 1, payload: { clientId: input.id } },
      }
    })
  }

  async transition(metadata: ClientCommandMetadata, clientId: string, expectedVersion: number, targetStatus: 'active' | 'paused') {
    idSchema.parse(clientId)
    versionSchema.parse(expectedVersion)
    const context = await this.authorized(metadata, 'client.manage', clientId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'client', clientId)
      const client = await readOwned(transaction, path, metadata.organizationId)
      assertClientStatusTransition(String(client.status), targetStatus)
      if (client.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      const version = expectedVersion + 1
      transaction.update(path, { status: targetStatus, version, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { clientId, version, status: targetStatus },
        resourceType: 'client',
        resourceId: clientId,
        outbox: { type: 'client.status_changed', version: 1, payload: { clientId, status: targetStatus } },
      }
    })
  }

  async addContact(metadata: ClientCommandMetadata, rawInput: z.input<typeof contactSchema>) {
    const parsed = contactSchema.parse(rawInput)
    const input = {
      ...parsed,
      name: normalizeClientName(parsed.name),
      email: normalizeEmail(parsed.email),
    }
    const context = await this.authorized(metadata, 'client.contact.manage', input.clientId)
    const protectedEmail = await this.protection.protectEmail({
      organizationId: metadata.organizationId,
      clientId: input.clientId,
      normalizedEmail: input.email,
    })
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(protectedEmail.keyVersion)
      || !/^[a-f0-9]{32,128}$/i.test(protectedEmail.deterministicHash)
      || protectedEmail.ciphertext.length < 16) {
      throw new Error('INVALID_PROTECTED_EMAIL')
    }
    return this.audit.execute(context, async (transaction) => {
      const client = await readOwned(transaction, tenantDocumentPath(metadata.organizationId, 'client', input.clientId), metadata.organizationId)
      if (!['lead', 'active', 'paused'].includes(String(client.status))) throw new Error('CLIENT_NOT_ACTIVE')
      const path = tenantDocumentPath(metadata.organizationId, 'client_contact', input.id)
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      const uniquePath = systemPath(metadata.organizationId, '_clientContactEmailHashes', stableId('contact', `${input.clientId}:${protectedEmail.deterministicHash}`))
      if ((await transaction.get(uniquePath))?.active === true) throw new Error('CLIENT_CONTACT_EMAIL_EXISTS')
      transaction.create(path, {
        ...baseRecord(metadata.organizationId),
        clientId: input.clientId,
        name: input.name,
        emailHash: protectedEmail.deterministicHash,
        emailCiphertext: protectedEmail.ciphertext,
        encryptionKeyVersion: protectedEmail.keyVersion,
        portalStatus: 'none',
        clientAdmin: input.clientAdmin,
      })
      transaction.create(uniquePath, {
        ...baseRecord(metadata.organizationId), active: true, contactId: input.id, clientId: input.clientId,
      })
      return {
        result: { contactId: input.id, version: 1, portalStatus: 'none' as const },
        resourceType: 'client_contact',
        resourceId: input.id,
        outbox: { type: 'client.contact_created', version: 1, payload: { clientId: input.clientId, contactId: input.id } },
      }
    })
  }

  async setPortalEligibility(metadata: ClientCommandMetadata, clientId: string, contactId: string, expectedVersion: number, eligible: boolean) {
    idSchema.parse(clientId)
    idSchema.parse(contactId)
    versionSchema.parse(expectedVersion)
    const context = await this.authorized(metadata, 'client.contact.manage', clientId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'client_contact', contactId)
      const contact = await readOwned(transaction, path, metadata.organizationId)
      if (contact.clientId !== clientId) throw new Error('CONTACT_CLIENT_MISMATCH')
      if (contact.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      if (!['none', 'eligible'].includes(String(contact.portalStatus))) throw new Error('PORTAL_STATUS_MANAGED_BY_INVITATION')
      const portalStatus = eligible ? 'eligible' : 'none'
      const version = expectedVersion + 1
      transaction.update(path, { portalStatus, version, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { contactId, portalStatus, version },
        resourceType: 'client_contact',
        resourceId: contactId,
        outbox: { type: 'client.contact_eligibility_changed', version: 1, payload: { clientId, contactId, eligible } },
      }
    })
  }

  async revokePortal(metadata: ClientCommandMetadata, clientId: string, contactId: string, expectedVersion: number) {
    idSchema.parse(clientId)
    idSchema.parse(contactId)
    versionSchema.parse(expectedVersion)
    const context = await this.authorized(metadata, 'client.contact.manage', clientId)
    let userId: string | undefined
    const result = await this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'client_contact', contactId)
      const contact = await readOwned(transaction, path, metadata.organizationId)
      if (contact.clientId !== clientId) throw new Error('CONTACT_CLIENT_MISMATCH')
      if (contact.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      userId = typeof contact.userId === 'string' ? contact.userId : undefined
      const version = expectedVersion + 1
      transaction.update(path, { portalStatus: 'disabled', version, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { contactId, portalStatus: 'disabled' as const, version },
        resourceType: 'client_contact',
        resourceId: contactId,
        outbox: { type: 'client.portal_revoked', version: 1, payload: { clientId, contactId, ...(userId ? { userId } : {}) } },
      }
    })
    if (userId) {
      try { await this.lifecycle.revokePortalIdentity(userId) } catch { throw new Error('PORTAL_REVOCATION_PENDING') }
    }
    return result
  }

  async archive(metadata: ClientCommandMetadata, clientId: string, expectedVersion: number) {
    idSchema.parse(clientId)
    versionSchema.parse(expectedVersion)
    const context = await this.authorized(metadata, 'client.archive', clientId)
    const contacts = await this.lifecycle.listContacts(metadata.organizationId, clientId)
    if (contacts.length > 200) throw new Error('CLIENT_ARCHIVE_REQUIRES_BATCH_WORKFLOW')
    const portalUsers: string[] = []
    const result = await this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'client', clientId)
      const client = await readOwned(transaction, path, metadata.organizationId)
      if (client.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      assertClientStatusTransition(String(client.status), 'archived')
      // Read phase — the client, its project counter, every contact, and the unique-code index are all
      // read before any write (Firestore transaction rule; the contact loop previously wrote per contact
      // then read the unique-code index afterward).
      const projectCount = await transaction.get(systemPath(metadata.organizationId, '_clientActiveProjectCounts', clientId))
      assertCanArchiveClient(count(projectCount))
      const contactUpdates: { path: string; version: number }[] = []
      for (const reference of contacts) {
        idSchema.parse(reference.id)
        versionSchema.parse(reference.expectedVersion)
        const contactPath = tenantDocumentPath(metadata.organizationId, 'client_contact', reference.id)
        const contact = await readOwned(transaction, contactPath, metadata.organizationId)
        if (contact.clientId !== clientId || contact.version !== reference.expectedVersion) throw new Error('CONTACT_REFERENCE_CONFLICT')
        contactUpdates.push({ path: contactPath, version: reference.expectedVersion + 1 })
        if (reference.userId) portalUsers.push(reference.userId)
      }
      const uniquePath = systemPath(metadata.organizationId, '_uniqueClientCodes', stableId('client', String(client.code)))
      const unique = await transaction.get(uniquePath)
      const version = expectedVersion + 1
      // Write phase.
      for (const contactUpdate of contactUpdates) {
        transaction.update(contactUpdate.path, { portalStatus: 'disabled', version: contactUpdate.version, updatedAt: SERVER_TIMESTAMP })
      }
      transaction.update(path, { status: 'archived', archivedAt: SERVER_TIMESTAMP, version, updatedAt: SERVER_TIMESTAMP })
      if (unique) transaction.update(uniquePath, { active: false, updatedAt: SERVER_TIMESTAMP })
      return {
        result: { clientId, status: 'archived' as const, version, disabledContacts: contacts.length },
        resourceType: 'client',
        resourceId: clientId,
        outbox: { type: 'client.archived', version: 1, payload: { clientId, disabledContacts: contacts.length } },
      }
    })
    const revocations = await Promise.allSettled(portalUsers.map((userId) => this.lifecycle.revokePortalIdentity(userId)))
    if (revocations.some(({ status }) => status === 'rejected')) throw new Error('PORTAL_REVOCATION_PENDING')
    return result
  }
}
