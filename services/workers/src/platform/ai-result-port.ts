import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { AIResultPort } from '../ai-gateway.js'

const tenantPath = (organizationId: string, kind: string, id: string) => `v2Organizations/${organizationId}/${kind}/${id}`

export function createFirestoreAiResultPort(firestore: Firestore): AIResultPort {
  return {
    async complete(input) {
      await firestore.runTransaction(async (transaction) => {
        const requestPath = tenantPath(input.organizationId, 'ai_request', input.requestId)
        const requestSnapshot = await transaction.get(firestore.doc(requestPath))
        if (!requestSnapshot.exists || requestSnapshot.data()?.status !== 'queued') return
        transaction.update(firestore.doc(requestPath), {
          status: 'completed', summary: input.summary, version: Number(requestSnapshot.data()!.version) + 1, updatedAt: FieldValue.serverTimestamp(),
        })
        for (const [index, proposal] of input.proposals.entries()) {
          const proposalId = `${input.requestId}-proposal-${index}`
          transaction.set(firestore.doc(tenantPath(input.organizationId, 'ai_action_proposal', proposalId)), {
            organizationId: input.organizationId, schemaVersion: 1, version: 1,
            aiRequestId: input.requestId, ...proposal,
            createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true })
        }
      })
    },
    async fail(input) {
      const requestPath = tenantPath(input.organizationId, 'ai_request', input.requestId)
      await firestore.doc(requestPath).update({
        status: 'failed', errorCode: input.errorCode, updatedAt: FieldValue.serverTimestamp(),
      })
    },
  }
}
