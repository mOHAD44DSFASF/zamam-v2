import { Timestamp, type FirestoreDataConverter, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { SCHEMA_VERSION, asUtcIsoString, type TenantEntity, type UtcIsoString } from '@zamam/domain'
import { z } from 'zod'

const tenantBaseSchema = z.object({
  organizationId: z.string().min(1).max(128),
  schemaVersion: z.literal(SCHEMA_VERSION),
  version: z.number().int().positive(),
  createdAt: z.instanceof(Timestamp),
  updatedAt: z.instanceof(Timestamp),
  deletedAt: z.instanceof(Timestamp).optional(),
}).passthrough()

function decodeValue(value: unknown, key = ''): unknown {
  if (value instanceof Timestamp) return asUtcIsoString(value.toDate().toISOString())
  if (value instanceof Date) throw new Error(`NON_CANONICAL_DATE:${key}`)
  if (Array.isArray(value)) return value.map((item) => decodeValue(item, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, decodeValue(child, childKey)]))
  }
  return value
}

function encodeValue(value: unknown, key = ''): unknown {
  if (value instanceof Date) throw new Error(`NON_CANONICAL_DATE:${key}`)
  if (Array.isArray(value)) return value.map((item) => encodeValue(item, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([childKey, child]) => [childKey, encodeValue(child, childKey)]))
  }
  if (key.endsWith('At') && typeof value === 'string') {
    const canonical = asUtcIsoString(value)
    return Timestamp.fromDate(new Date(canonical))
  }
  return value
}

export function decodeTenantDocument<T extends TenantEntity>(id: string, data: unknown): T {
  const parsed = tenantBaseSchema.parse(data)
  const decoded = decodeValue(parsed) as Record<string, unknown>
  return { id, ...decoded } as T
}

export function encodeTenantDocument<T extends TenantEntity>(entity: T): FirebaseFirestore.DocumentData {
  if (!entity.organizationId || entity.schemaVersion !== SCHEMA_VERSION || entity.version < 1) throw new Error('INVALID_TENANT_ENTITY')
  const { id: _id, ...data } = entity
  void _id
  return encodeValue(data) as FirebaseFirestore.DocumentData
}

export function createTenantConverter<T extends TenantEntity>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (entity) => encodeTenantDocument(entity as T),
    fromFirestore: (snapshot: QueryDocumentSnapshot) => decodeTenantDocument<T>(snapshot.id, snapshot.data()),
  }
}

export interface TimestampPolicy {
  persistence: 'Firestore Timestamp'
  domain: UtcIsoString
  display: 'organization timezone'
}
