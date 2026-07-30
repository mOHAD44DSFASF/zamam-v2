import type { Firestore } from 'firebase-admin/firestore'
import { tenantCollectionPath, tenantDocumentPath, type AtomicStore, type PageQuery, type QueryStore } from '@zamam/firestore'
import type { AuthorizationPrincipal, AuthorizationRequest, ResourceAuthorizationContext } from '@zamam/authorization'
import type { TenantEntityKind } from '@zamam/domain'
import type { TrustedAuthorizationService } from '../authorization/service.js'
import type { PrivateObjectStorage } from '../file/storage.js'

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
      visibility: record.clientVisible ? 'client' : 'internal', clientAccountId: String(record.clientId),
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
