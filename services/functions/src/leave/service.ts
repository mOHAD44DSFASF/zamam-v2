import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { leaveDaysInclusive, SCHEMA_VERSION } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type StoredDocument } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id = z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const requestSchema = z.object({ id, leaveTypeId: id, startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(3).max(500) }).strict()
export interface LeaveGate { require(principal: AuthorizationPrincipal, request: AuthorizationRequest): Promise<unknown> }
export interface LeaveLookup {
  getRequest(organizationId: string, requestId: string): Promise<StoredDocument | null>
  getBalance(organizationId: string, balanceId: string): Promise<StoredDocument | null>
  hasOverlap(organizationId: string, userId: string, startsOn: string, endsOn: string): Promise<boolean>
}
export interface LeaveApproverResolver { resolve(organizationId: string, userId: string, quantityDays: number): Promise<readonly string[]> }
export interface LeaveMetadata { organizationId: string; principal: AuthorizationPrincipal; correlationId: string; idempotencyKey: string; fingerprint: string }
const base = (organizationId: string) => ({ organizationId, schemaVersion: SCHEMA_VERSION, version: 1, createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP })
const balanceId = (userId: string, typeId: string, year: number) => `balance-${year}-${userId}-${typeId}`
export class LeaveService {
  private readonly audit: AuditCommandService
  constructor(private readonly store: AtomicStore, private readonly gate: LeaveGate, private readonly lookup: LeaveLookup, private readonly approvers: LeaveApproverResolver, audit?: AuditCommandService) { this.audit = audit ?? new AuditCommandService(store) }
  private async context(metadata: LeaveMetadata, permission: 'leave.request' | 'leave.approve', userId: string, resourceId: string) {
    await this.gate.require(metadata.principal, { permission, organizationId: metadata.organizationId, resource: { type: 'user', id: userId, organizationId: metadata.organizationId, ownerUserId: userId, visibility: 'restricted' } })
    return { organizationId: metadata.organizationId, actorUserId: metadata.principal.userId, permission, correlationId: metadata.correlationId, idempotencyKey: metadata.idempotencyKey, fingerprint: metadata.fingerprint, resourceId }
  }
  async request(metadata: LeaveMetadata, raw: z.input<typeof requestSchema>) {
    const input = requestSchema.parse(raw)
    const quantityDays = leaveDaysInclusive(input.startsOn, input.endsOn)
    if (await this.lookup.hasOverlap(metadata.organizationId, metadata.principal.userId, input.startsOn, input.endsOn)) throw new Error('LEAVE_OVERLAP')
    const requiredApproverIds = await this.approvers.resolve(metadata.organizationId, metadata.principal.userId, quantityDays)
    if (!requiredApproverIds.length || requiredApproverIds.includes(metadata.principal.userId)) throw new Error('LEAVE_APPROVAL_CHAIN_INVALID')
    const year = Number(input.startsOn.slice(0, 4))
    const balanceRecordId = balanceId(metadata.principal.userId, input.leaveTypeId, year)
    const balance = await this.lookup.getBalance(metadata.organizationId, balanceRecordId)
    if (!balance) throw new Error('LEAVE_BALANCE_UNAVAILABLE')
    if (balance.source === 'external_hr') throw new Error('LEAVE_EXTERNAL_HR_READ_ONLY')
    if (Number(balance.allowanceDays) - Number(balance.usedDays) - Number(balance.pendingDays) < quantityDays) throw new Error('LEAVE_BALANCE_INSUFFICIENT')
    const context = await this.context(metadata, 'leave.request', metadata.principal.userId, input.id)
    return this.audit.execute(context, async (transaction) => {
      // Read phase — the balance is read before any write (Firestore transaction rule; the leave_request
      // create previously preceded this read).
      const balancePath = tenantDocumentPath(metadata.organizationId, 'leave_balance', balanceRecordId)
      const current = await transaction.get(balancePath)
      if (!current || current.version !== balance.version) throw new Error('VERSION_CONFLICT')
      // Write phase.
      transaction.create(tenantDocumentPath(metadata.organizationId, 'leave_request', input.id), { ...base(metadata.organizationId), userId: metadata.principal.userId, leaveTypeId: input.leaveTypeId, startsOn: input.startsOn, endsOn: input.endsOn, quantityDays, reason: input.reason, status: 'submitted', requiredApproverIds, currentApprovalStep: 0, balanceId: balanceRecordId })
      transaction.update(balancePath, { pendingDays: Number(current.pendingDays) + quantityDays, version: Number(current.version) + 1, updatedAt: SERVER_TIMESTAMP })
      const ledgerId = `leave-ledger-reserve-${input.id}`
      transaction.create(tenantDocumentPath(metadata.organizationId, 'leave_ledger', ledgerId), { ...base(metadata.organizationId), leaveRequestId: input.id, leaveBalanceId: balanceRecordId, quantityDays, operation: 'reserve', occurredAt: SERVER_TIMESTAMP })
      return { result: { requestId: input.id, quantityDays, status: 'submitted' as const, version: 1 }, resourceType: 'leave_request', resourceId: input.id, outbox: { type: 'leave.requested', version: 1, payload: { leaveRequestId: input.id } } }
    })
  }
  async decide(metadata: LeaveMetadata, requestId: string, expectedVersion: number, decision: 'approved' | 'rejected', reason?: string) {
    id.parse(requestId)
    if (decision === 'rejected' && (!reason || reason.trim().length < 3)) throw new Error('LEAVE_REJECTION_REASON_REQUIRED')
    const request = await this.lookup.getRequest(metadata.organizationId, requestId)
    if (!request || request.status !== 'submitted') throw new Error('LEAVE_NOT_SUBMITTED')
    const userId = String(request.userId)
    if (userId === metadata.principal.userId) throw new Error('LEAVE_SELF_APPROVAL_DENIED')
    const chain = request.requiredApproverIds as readonly string[]
    const step = Number(request.currentApprovalStep)
    if (chain[step] !== metadata.principal.userId) throw new Error('LEAVE_APPROVER_ORDER_DENIED')
    const context = await this.context(metadata, 'leave.approve', userId, requestId)
    return this.audit.execute(context, async (transaction) => {
      const path = tenantDocumentPath(metadata.organizationId, 'leave_request', requestId)
      const current = await transaction.get(path)
      if (!current || current.version !== expectedVersion) throw new Error('VERSION_CONFLICT')
      const finalApproval = decision === 'approved' && step === chain.length - 1
      const nextStatus = decision === 'rejected' ? 'rejected' : finalApproval ? 'approved' : 'submitted'
      const touchesBalance = finalApproval || decision === 'rejected'
      // Read phase — the balance (only touched on final approval/rejection) is read before any write
      // (Firestore transaction rule; the approval create + request update previously preceded this read).
      const balancePath = tenantDocumentPath(metadata.organizationId, 'leave_balance', String(current.balanceId))
      const balance = touchesBalance ? await transaction.get(balancePath) : null
      if (touchesBalance && !balance) throw new Error('LEAVE_BALANCE_UNAVAILABLE')
      // Write phase.
      const approvalId = `leave-approval-${requestId}-${step + 1}`
      transaction.create(tenantDocumentPath(metadata.organizationId, 'leave_approval', approvalId), { ...base(metadata.organizationId), leaveRequestId: requestId, step: step + 1, approverUserId: metadata.principal.userId, decision, ...(reason ? { reason: reason.trim() } : {}), decidedAt: SERVER_TIMESTAMP })
      transaction.update(path, { status: nextStatus, currentApprovalStep: decision === 'approved' ? step + 1 : step, ...(nextStatus !== 'submitted' ? { decidedAt: SERVER_TIMESTAMP } : {}), version: expectedVersion + 1, updatedAt: SERVER_TIMESTAMP })
      if (touchesBalance && balance) {
        const quantity = Number(current.quantityDays)
        transaction.update(balancePath, { pendingDays: Math.max(0, Number(balance.pendingDays) - quantity), usedDays: Number(balance.usedDays) + (finalApproval ? quantity : 0), version: Number(balance.version) + 1, updatedAt: SERVER_TIMESTAMP })
        const operation = finalApproval ? 'consume' : 'release'
        transaction.create(tenantDocumentPath(metadata.organizationId, 'leave_ledger', `leave-ledger-${operation}-${requestId}`), { ...base(metadata.organizationId), leaveRequestId: requestId, leaveBalanceId: String(current.balanceId), quantityDays: quantity, operation, occurredAt: SERVER_TIMESTAMP })
      }
      return { result: { requestId, status: nextStatus, version: expectedVersion + 1 }, resourceType: 'leave_request', resourceId: requestId, outbox: { type: finalApproval ? 'leave.approved' : decision === 'rejected' ? 'leave.rejected' : 'leave.approval_advanced', version: 1, payload: { leaveRequestId: requestId } } }
    })
  }
}
