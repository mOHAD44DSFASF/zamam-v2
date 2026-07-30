export const SCHEMA_VERSION = 2 as const
export type UtcIsoString = string & { readonly __utcIso: unique symbol }

export function asUtcIsoString(value: string): UtcIsoString {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error('INVALID_UTC_TIMESTAMP')
  return value as UtcIsoString
}

export interface EntityBase {
  id: string
  schemaVersion: typeof SCHEMA_VERSION
  version: number
  createdAt: UtcIsoString
  updatedAt: UtcIsoString
  deletedAt?: UtcIsoString
}

export interface TenantEntity extends EntityBase {
  organizationId: string
}

export interface GlobalEntity extends EntityBase {
  organizationId?: never
}

export interface ActorStamp {
  actorUserId: string | null
  correlationId: string
}

export interface ArchiveFields {
  archivedAt?: UtcIsoString
  archivedBy?: string
  archiveReason?: string
}
