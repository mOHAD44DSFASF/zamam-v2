import type { Firestore } from 'firebase-admin/firestore'
import type { TrustedRole, TrustedRoleAssignment } from '@zamam/authorization'
import type { PolicySnapshot } from './service.js'

function toRole(id: string, data: FirebaseFirestore.DocumentData): TrustedRole {
  return {
    id,
    organizationId: String(data.organizationId ?? null),
    name: String(data.name),
    permissions: Array.isArray(data.permissions) ? data.permissions.map(String) : [],
    status: data.status === 'archived' ? 'archived' : 'active',
    policyVersion: Number(data.policyVersion ?? 1),
  }
}

function toAssignment(id: string, data: FirebaseFirestore.DocumentData): TrustedRoleAssignment {
  return {
    id,
    organizationId: String(data.organizationId ?? null),
    userId: String(data.userId),
    roleId: String(data.roleId),
    scope: { type: data.scopeType, id: String(data.scopeId) },
    effect: data.effect === 'deny' ? 'deny' : 'grant',
    ...(Array.isArray(data.permissions) ? { permissions: data.permissions.map(String) } : {}),
    status: data.status === 'revoked' ? 'revoked' : 'active',
    ...(typeof data.startsAt === 'string' ? { startsAt: data.startsAt } : {}),
    ...(typeof data.expiresAt === 'string' ? { expiresAt: data.expiresAt } : {}),
  }
}

export class FirestorePolicyStore {
  constructor(private readonly firestore: Firestore) {}

  async load(userId: string, organizationId: string | null): Promise<PolicySnapshot> {
    if (!organizationId) return { roles: [], assignments: [], version: 0 }
    const [rolesSnapshot, assignmentsSnapshot] = await Promise.all([
      this.firestore.collection(`v2Organizations/${organizationId}/role`).where('status', '==', 'active').get(),
      this.firestore.collection(`v2Organizations/${organizationId}/role_assignment`)
        .where('userId', '==', userId).where('status', '==', 'active').get(),
    ])
    const roles = rolesSnapshot.docs.map((doc) => toRole(doc.id, doc.data()))
    const assignments = assignmentsSnapshot.docs.map((doc) => toAssignment(doc.id, doc.data()))
    const version = Math.max(0, ...roles.map((role) => role.policyVersion))
    return { roles, assignments, version }
  }
}

export class FirestoreAuthorizationAuditPort {
  constructor(private readonly firestore: Firestore) {}

  async record(input: {
    actorUserId: string
    organizationId: string | null
    permission: string
    allowed: boolean
    reason: string
    policyVersion: number
  }): Promise<void> {
    if (!input.organizationId) return
    await this.firestore.collection(`v2Organizations/${input.organizationId}/_authorizationAuditEvents`).add({
      actorUserId: input.actorUserId, permission: input.permission, allowed: input.allowed,
      reason: input.reason, policyVersion: input.policyVersion, recordedAt: new Date().toISOString(),
    })
  }
}
