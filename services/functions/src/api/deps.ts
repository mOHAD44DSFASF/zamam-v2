import type { Firestore } from 'firebase-admin/firestore'
import { tenantCollectionPath, tenantDocumentPath, type AtomicStore, type PageQuery, type QueryStore } from '@zamam/firestore'
import type { AuthorizationPrincipal, AuthorizationRequest, ResourceAuthorizationContext } from '@zamam/authorization'
import type { TenantEntityKind } from '@zamam/domain'
import type { TrustedAuthorizationService } from '../authorization/service.js'
import type { PrivateObjectStorage } from '@zamam/workers'

export interface Gate {
  require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown>
}

export interface Deps {
  firestore: Firestore
  store: AtomicStore
  queries: QueryStore
  authorization: TrustedAuthorizationService
  storage: PrivateObjectStorage
  now: () => Date
}

export async function readDoc(firestore: Firestore, path: string): Promise<Readonly<Record<string, unknown>> | null> {
  const snapshot = await firestore.doc(path).get()
  return snapshot.exists ? (snapshot.data()! as Readonly<Record<string, unknown>>) : null
}

export function orgPath(organizationId: string, kind: string, id: string) {
  return `v2Organizations/${organizationId}/${kind}/${id}`
}

export async function resolveTaskOrProjectResource(
  deps: Deps, organizationId: string, type: 'task' | 'project', id: string,
): Promise<ResourceAuthorizationContext | null> {
  const record = await readDoc(deps.firestore, orgPath(organizationId, type, id))
  if (!record) return null
  if (type === 'project') {
    return {
      type: 'project', id, organizationId, projectId: id,
      visibility: record.clientVisible ? 'client' : 'internal',
      ...(typeof record.clientId === 'string' ? { clientAccountId: record.clientId } : {}),
    }
  }
  let clientAccountId: string | undefined
  if (record.clientVisible && typeof record.projectId === 'string') {
    const project = await readDoc(deps.firestore, tenantDocumentPath(organizationId, 'project', record.projectId))
    clientAccountId = project ? String(project.clientId) : undefined
  }
  return {
    type: 'task', id, organizationId,
    ...(typeof record.projectId === 'string' ? { projectId: record.projectId } : {}),
    ...(typeof record.workspaceId === 'string' ? { workspaceId: record.workspaceId } : {}),
    ...(typeof record.createdBy === 'string' ? { ownerUserId: record.createdBy } : {}),
    assigneeUserIds: typeof record.assigneeUserId === 'string' ? [record.assigneeUserId] : [],
    visibility: record.clientVisible ? 'client' as const : 'internal' as const,
    ...(clientAccountId ? { clientAccountId } : {}),
  }
}

/**
 * Computes the organization-scoped capability flags a page uses to show/hide action buttons, by asking
 * the same TrustedAuthorizationService that gates the corresponding commands (`.evaluate` — the read-only
 * counterpart of `.require`). This exposes existing authorization for UI purposes only; it never changes
 * what is allowed, and the command handlers still enforce independently. Mirrors the inline pattern the
 * `/v1/organization/directory/query` handler already uses.
 */
export async function evaluateCapabilities<K extends string>(
  deps: Deps,
  principal: AuthorizationPrincipal,
  organizationId: string,
  permissionByCapability: Readonly<Record<K, AuthorizationRequest['permission']>>,
): Promise<Record<K, boolean>> {
  const entries = Object.entries(permissionByCapability) as [K, AuthorizationRequest['permission']][]
  const results = await Promise.all(entries.map(async ([capability, permission]) => {
    const decision = await deps.authorization.evaluate(principal, { permission, organizationId })
    return [capability, decision.allowed] as const
  }))
  return Object.fromEntries(results) as Record<K, boolean>
}

/**
 * Batch-resolves a display field (e.g. name) for a set of entity ids, so list handlers can return human
 * names instead of raw ids without an N+1 query. De-duplicates ids and reads each doc once. Reuses the
 * same tenant document layout every service writes to; no new storage.
 */
export async function resolveNames(
  deps: Deps,
  organizationId: string,
  kind: TenantEntityKind,
  ids: readonly string[],
  field = 'name',
): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter(Boolean))]
  const entries = await Promise.all(unique.map(async (id) => {
    const doc = await readDoc(deps.firestore, tenantDocumentPath(organizationId, kind, id))
    const value = doc?.[field]
    return [id, typeof value === 'string' ? value : null] as const
  }))
  return new Map(entries)
}

export function listQuery<T = Record<string, unknown>>(
  deps: Deps,
  organizationId: string,
  entityKind: TenantEntityKind,
  opts: { filters?: PageQuery['filters']; orderBy: PageQuery['orderBy']; limit: number; cursor?: readonly unknown[] },
) {
  const query: PageQuery = {
    organizationId, entityKind, orderBy: opts.orderBy, limit: opts.limit,
    ...(opts.filters ? { filters: opts.filters } : {}),
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
  }
  return deps.queries.list<T>(tenantCollectionPath(organizationId, entityKind), query)
}
