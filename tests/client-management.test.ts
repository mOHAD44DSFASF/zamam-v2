import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { projectClientFields } from '@zamam/domain'
import type { AtomicStore, AtomicTransaction, StoredDocument } from '@zamam/firestore'
import {
  ClientService,
  type ClientAuthorizationGate,
  type ClientCommandMetadata,
  type ClientContactReference,
  type ClientDataProtectionPort,
  type ClientLifecyclePort,
} from '../services/functions/src/client/service'
import { AesGcmClientDataProtectionAdapter } from '../services/functions/src/client/aes-data-protection'
import type { SecretName, SecretProvider } from '../services/functions/src/platform/ports'

class MemoryStore implements AtomicStore {
  records = new Map<string, StoredDocument>()
  async runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>): Promise<TResult> {
    const working = new Map([...this.records].map(([path, value]) => [path, { ...value }]))
    const transaction: AtomicTransaction = {
      get: async (path) => working.get(path) ?? null,
      create: (path, data) => {
        if (working.has(path)) throw new Error('ALREADY_EXISTS')
        working.set(path, { ...data })
      },
      update: (path, data) => {
        const current = working.get(path)
        if (!current) throw new Error('NOT_FOUND')
        working.set(path, { ...current, ...data })
      },
    }
    const result = await operation(transaction)
    this.records = working
    return result
  }
}

class Gate implements ClientAuthorizationGate {
  requests: AuthorizationRequest[] = []
  async require(principal: AuthorizationPrincipal, request: AuthorizationRequest) {
    this.requests.push(request)
    if (request.organizationId !== principal.organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
  }
}

const protection: ClientDataProtectionPort = {
  protectEmail: vi.fn(async ({ organizationId, clientId, normalizedEmail }) => ({
    deterministicHash: createHash('sha256').update(`${organizationId}:${clientId}:${normalizedEmail}`).digest('hex'),
    ciphertext: `ciphertext-value:${Buffer.from(normalizedEmail).toString('base64')}`,
    keyVersion: 'kms-v001',
  })),
  revealEmail: vi.fn(async () => 'contact@example.com'),
}

function lifecycle(contacts: readonly ClientContactReference[] = []): ClientLifecyclePort {
  return {
    listContacts: vi.fn().mockResolvedValue(contacts),
    revokePortalIdentity: vi.fn().mockResolvedValue(undefined),
  }
}

const principal: AuthorizationPrincipal = {
  userId: 'manager-1', authenticated: true, tokenFresh: true, accountStatus: 'active',
  employmentStatus: 'active', organizationId: 'org-1', membershipStatus: 'active',
  principalType: 'member', clientAccountIds: [], stepUpSatisfied: true, mfaSatisfied: true,
}
let sequence = 0
const metadata = (organizationId = 'org-1'): ClientCommandMetadata => {
  sequence += 1
  return {
    organizationId, principal, correlationId: `correlation-${sequence}`,
    idempotencyKey: `idempotency-${sequence}`, fingerprint: `fingerprint-${sequence}`,
  }
}

describe('client lifecycle and privacy', () => {
  it('encrypts contact email with tenant-bound AES-GCM and deterministic keyed lookup', async () => {
    const encryptionKey = Buffer.alloc(32, 7).toString('base64')
    const hashKey = Buffer.alloc(32, 9).toString('base64')
    const values: Record<SecretName, string> = {
      R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', OPENAI_API_KEY: '', EMAIL_PROVIDER_API_KEY: '',
      CLIENT_PII_ENCRYPTION_KEY: encryptionKey, CLIENT_PII_HASH_KEY: hashKey, CLIENT_PII_KEY_VERSION: 'local-v001',
    }
    const secrets: SecretProvider = { get: async (name) => values[name] }
    const adapter = new AesGcmClientDataProtectionAdapter(secrets)
    const protectedEmail = await adapter.protectEmail({
      organizationId: 'org-1', clientId: 'client-1', normalizedEmail: 'Contact@Example.com',
    })
    expect(protectedEmail.ciphertext).not.toContain('contact@example.com')
    expect(protectedEmail.deterministicHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await adapter.revealEmail({
      organizationId: 'org-1', clientId: 'client-1',
      ciphertext: protectedEmail.ciphertext, keyVersion: protectedEmail.keyVersion,
    })).toBe('contact@example.com')
    await expect(adapter.revealEmail({
      organizationId: 'org-2', clientId: 'client-1',
      ciphertext: protectedEmail.ciphertext, keyVersion: protectedEmail.keyVersion,
    })).rejects.toThrow()
  })

  it('creates and transitions a scoped client with unique code and audit', async () => {
    const store = new MemoryStore()
    const gate = new Gate()
    const service = new ClientService(store, gate, protection, lifecycle())
    await service.create(metadata(), {
      id: 'client-1', name: 'شركة العميل', code: ' acme ', industry: 'تقنية', accountManagerUserId: 'manager-1',
    })
    await service.transition(metadata(), 'client-1', 1, 'active')
    expect(store.records.get('v2Organizations/org-1/client/client-1')).toMatchObject({
      code: 'ACME', status: 'active', version: 2,
    })
    await expect(service.create(metadata(), { id: 'client-2', name: 'عميل مكرر', code: 'ACME' }))
      .rejects.toThrow('CLIENT_CODE_ALREADY_EXISTS')
    expect(gate.requests.map(({ permission }) => permission)).toEqual(['client.create', 'client.manage', 'client.create'])
  })

  it('stores protected contact email and does not grant portal access by contact existence', async () => {
    const store = new MemoryStore()
    const service = new ClientService(store, new Gate(), protection, lifecycle())
    await service.create(metadata(), { id: 'client-1', name: 'شركة العميل', code: 'CLIENT' })
    const result = await service.addContact(metadata(), {
      id: 'contact-1', clientId: 'client-1', name: 'مسؤول العميل', email: ' Contact@Example.com ', clientAdmin: true,
    })
    const contact = store.records.get('v2Organizations/org-1/client_contact/contact-1')
    expect(result.result.portalStatus).toBe('none')
    expect(contact).toMatchObject({
      clientId: 'client-1', portalStatus: 'none', clientAdmin: true, encryptionKeyVersion: 'kms-v001',
    })
    expect(contact).not.toHaveProperty('email')
    expect(JSON.stringify(contact)).not.toContain('contact@example.com')
    expect([...store.records.keys()].some((path) => path.includes('/organization_membership/'))).toBe(false)
    expect([...store.records.keys()].some((path) => path.includes('/role_assignment/'))).toBe(false)
  })

  it('changes eligibility without creating identity and revokes an attached portal identity', async () => {
    const store = new MemoryStore()
    const adapter = lifecycle()
    const service = new ClientService(store, new Gate(), protection, adapter)
    await service.create(metadata(), { id: 'client-1', name: 'شركة العميل', code: 'CLIENT' })
    await service.addContact(metadata(), {
      id: 'contact-1', clientId: 'client-1', name: 'مسؤول العميل', email: 'contact@example.com',
    })
    await service.setPortalEligibility(metadata(), 'client-1', 'contact-1', 1, true)
    expect(store.records.get('v2Organizations/org-1/client_contact/contact-1')).toMatchObject({ portalStatus: 'eligible', version: 2 })
    expect(adapter.revokePortalIdentity).not.toHaveBeenCalled()
    store.records.set('v2Organizations/org-1/client_contact/contact-1', {
      ...store.records.get('v2Organizations/org-1/client_contact/contact-1')!,
      portalStatus: 'active', userId: 'portal-user',
    })
    await service.revokePortal(metadata(), 'client-1', 'contact-1', 2)
    expect(adapter.revokePortalIdentity).toHaveBeenCalledWith('portal-user')
    expect(store.records.get('v2Organizations/org-1/client_contact/contact-1')).toMatchObject({ portalStatus: 'disabled', version: 3 })
  })

  it('blocks archival with active projects, then disables contacts and archives without deletion', async () => {
    const store = new MemoryStore()
    const contacts = [{ id: 'contact-1', expectedVersion: 1, userId: 'portal-user' }]
    const adapter = lifecycle(contacts)
    const service = new ClientService(store, new Gate(), protection, adapter)
    await service.create(metadata(), { id: 'client-1', name: 'شركة العميل', code: 'CLIENT' })
    await service.transition(metadata(), 'client-1', 1, 'active')
    await service.addContact(metadata(), {
      id: 'contact-1', clientId: 'client-1', name: 'مسؤول العميل', email: 'contact@example.com',
    })
    store.records.set('v2Organizations/org-1/_clientActiveProjectCounts/client-1', { organizationId: 'org-1', value: 1 })
    await expect(service.archive(metadata(), 'client-1', 2)).rejects.toThrow('CLIENT_HAS_ACTIVE_PROJECTS')
    store.records.set('v2Organizations/org-1/_clientActiveProjectCounts/client-1', { organizationId: 'org-1', value: 0 })
    const archived = await service.archive(metadata(), 'client-1', 2)
    expect(archived.result.disabledContacts).toBe(1)
    expect(store.records.get('v2Organizations/org-1/client/client-1')).toMatchObject({ status: 'archived', version: 3 })
    expect(store.records.get('v2Organizations/org-1/client_contact/contact-1')).toMatchObject({ portalStatus: 'disabled', version: 2 })
    expect(adapter.revokePortalIdentity).toHaveBeenCalledWith('portal-user')
  })

  it('denies cross-organization commands before storage mutation', async () => {
    const store = new MemoryStore()
    const service = new ClientService(store, new Gate(), protection, lifecycle())
    await expect(service.create(metadata('org-2'), { id: 'client-x', name: 'عميل خارجي', code: 'OTHER' }))
      .rejects.toThrow('CROSS_ORGANIZATION_DENIED')
    expect(store.records.size).toBe(0)
  })

  it('separates summary, internal, and financial projections', () => {
    const source = {
      id: 'client-1', name: 'عميل', code: 'CLIENT', industry: 'تقنية', status: 'active',
      accountManagerUserId: 'manager-1', financial: { contractValue: 1_000_000 },
    }
    expect(projectClientFields(source, 'summary')).not.toHaveProperty('accountManagerUserId')
    expect(projectClientFields(source, 'internal')).not.toHaveProperty('financial')
    expect(projectClientFields(source, 'financial')).toHaveProperty('financial')
  })
})
