import { tenantDocumentPath } from '@zamam/firestore'
import { AIService, type AILookup, type AIPolicyPort } from '../../ai/service.js'
import { FirestoreRateLimiter } from '../../platform/firestore-runtime.js'
import type { Deps } from '../deps.js'
import { listQuery, readDoc } from '../deps.js'
import type { HandlerRegistry } from '../registry.js'
import { requireNumber, requireString } from '../registry.js'

// v1 simplification: AI is enabled only when OPENAI_API_KEY is configured; conservative classification
// allowlist until a per-organization AI policy entity exists (matches OWNER_DECISIONS §8 disabled/demo mode).
function createPolicyPort(deps: Deps): AIPolicyPort {
  const rateLimiter = new FirestoreRateLimiter(deps.firestore, deps.now)
  return {
    async policy() {
      return {
        enabled: Boolean(process.env.OPENAI_API_KEY),
        allowedClassifications: ['operational_public', 'internal'],
        modelPolicyId: 'default', maxRequestsPerHour: 20, retentionHours: 72,
      }
    },
    consumeQuota: (organizationId, userId, limit) => rateLimiter.consume(`ai-quota:${organizationId}:${userId}`, limit, 3600),
  }
}

function createLookupPort(deps: Deps): AILookup {
  return { getProposal: (organizationId, proposalId) => readDoc(deps.firestore, tenantDocumentPath(organizationId, 'ai_action_proposal', proposalId)) }
}

export function createAiHandlers(deps: Deps): HandlerRegistry {
  const service = new AIService(deps.store, deps.authorization, createPolicyPort(deps), createLookupPort(deps))
  const metadata = (context: { organizationId: string; principal: unknown; correlationId: string; idempotencyKey: string; fingerprint: string }) => ({
    organizationId: context.organizationId, principal: context.principal as Parameters<typeof service.request>[0]['principal'],
    correlationId: context.correlationId, idempotencyKey: context.idempotencyKey, fingerprint: context.fingerprint,
  })

  return {
    '/v1/ai/query': async (context) => {
      await deps.authorization.require(context.principal, { permission: 'ai.view_history', organizationId: context.organizationId })
      const [requests, proposals] = await Promise.all([
        listQuery(deps, context.organizationId, 'ai_request', {
          filters: [{ field: 'requestedBy', operator: '==', value: context.principal.userId }],
          orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 25,
        }),
        listQuery(deps, context.organizationId, 'ai_action_proposal', {
          filters: [{ field: 'status', operator: '==', value: 'proposed' }],
          orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 25,
        }),
      ])
      return { requests: requests.items, proposals: proposals.items }
    },
    '/v1/ai/request': (context, input) => service.request(metadata(context), {
      id: requireString(input, 'id'), purpose: requireString(input, 'purpose') as 'summarize' | 'draft' | 'suggest_actions',
      content: requireString(input, 'content'),
      classification: requireString(input, 'classification') as 'operational_public' | 'internal' | 'client_confidential' | 'hr_sensitive' | 'financial_sensitive',
    }),
    '/v1/ai/proposals/decide': (context, input) => service.decideProposal(
      metadata(context), requireString(input, 'proposalId'), requireNumber(input, 'expectedVersion'),
      requireString(input, 'decision') as 'approved' | 'rejected', requireString(input, 'expectedHash'),
    ),
  }
}
