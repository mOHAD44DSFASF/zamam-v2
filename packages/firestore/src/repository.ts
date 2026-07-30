import { SCHEMA_VERSION, type TenantEntityKind } from '@zamam/domain'

export const SERVER_TIMESTAMP = Object.freeze({ __serverTimestamp: true as const })
export type ServerTimestamp = typeof SERVER_TIMESTAMP
export type StoredDocument = Readonly<Record<string, unknown>>

export interface AtomicTransaction {
  get(path: string): Promise<StoredDocument | null>
  create(path: string, data: StoredDocument): void
  update(path: string, data: StoredDocument): void
}

export interface AtomicStore {
  runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>): Promise<TResult>
}

export interface PageQuery {
  organizationId: string
  entityKind: TenantEntityKind
  filters?: readonly { field: string; operator: '==' | '<' | '<=' | '>' | '>=' | 'array-contains'; value: unknown }[]
  orderBy: readonly { field: string; direction: 'asc' | 'desc' }[]
  limit: number
  cursor?: readonly unknown[]
}

export interface PageResult<T> { items: readonly T[]; nextCursor: readonly unknown[] | null }
export interface QueryStore { list<T>(path: string, query: PageQuery): Promise<PageResult<T>> }

export function tenantCollectionPath(organizationId: string, entityKind: TenantEntityKind) {
  if (!/^[A-Za-z0-9_-]{2,128}$/.test(organizationId)) throw new Error('INVALID_ORGANIZATION_ID')
  return `v2Organizations/${organizationId}/${entityKind}`
}

export function tenantDocumentPath(organizationId: string, entityKind: TenantEntityKind, id: string) {
  if (!/^[A-Za-z0-9_-]{2,128}$/.test(id)) throw new Error('INVALID_DOCUMENT_ID')
  return `${tenantCollectionPath(organizationId, entityKind)}/${id}`
}

const immutableFields = new Set(['id', 'organizationId', 'schemaVersion', 'createdAt', 'updatedAt', 'deletedAt', 'version'])

export class TenantRepository {
  constructor(private readonly store: AtomicStore, private readonly queries?: QueryStore) {}

  async create(organizationId: string, kind: TenantEntityKind, id: string, data: StoredDocument) {
    const path = tenantDocumentPath(organizationId, kind, id)
    return this.store.runTransaction(async (transaction) => {
      if (await transaction.get(path)) throw new Error('ENTITY_ALREADY_EXISTS')
      transaction.create(path, {
        ...data, organizationId, schemaVersion: SCHEMA_VERSION, version: 1,
        createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP,
      })
      return { id, organizationId, version: 1 }
    })
  }

  async update(organizationId: string, kind: TenantEntityKind, id: string, expectedVersion: number, patch: StoredDocument) {
    for (const field of Object.keys(patch)) if (immutableFields.has(field)) throw new Error(`IMMUTABLE_FIELD:${field}`)
    const path = tenantDocumentPath(organizationId, kind, id)
    return this.store.runTransaction(async (transaction) => {
      const current = await transaction.get(path)
      if (!current) throw new Error('ENTITY_NOT_FOUND')
      if (current.organizationId !== organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
      if (current.deletedAt) throw new Error('ENTITY_ARCHIVED')
      if (current.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      const version = expectedVersion + 1
      transaction.update(path, { ...patch, version, updatedAt: SERVER_TIMESTAMP })
      return { id, organizationId, version }
    })
  }

  async archive(organizationId: string, kind: TenantEntityKind, id: string, expectedVersion: number) {
    const path = tenantDocumentPath(organizationId, kind, id)
    return this.store.runTransaction(async (transaction) => {
      const current = await transaction.get(path)
      if (!current) throw new Error('ENTITY_NOT_FOUND')
      if (current.organizationId !== organizationId) throw new Error('CROSS_ORGANIZATION_DENIED')
      if (current.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      transaction.update(path, { deletedAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP, version: expectedVersion + 1 })
    })
  }

  async list<T>(query: PageQuery): Promise<PageResult<T>> {
    if (!this.queries) throw new Error('QUERY_STORE_NOT_CONFIGURED')
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new Error('UNBOUNDED_QUERY_DENIED')
    if (query.orderBy.length === 0) throw new Error('ORDER_REQUIRED')
    return this.queries.list<T>(tenantCollectionPath(query.organizationId, query.entityKind), query)
  }
}
