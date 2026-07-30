import type { AuthenticatedPrincipal } from '@zamam/contracts'
import type { IdentityResolver } from '../platform/identity.js'
import type { TrustedApiRouteContext } from './api.js'
import type { FeatureApiPath, FeatureCommandDispatcher } from './feature-routes.js'
import { fingerprintInput, type HandlerRegistry } from './registry.js'

export class ComposedFeatureCommandDispatcher implements FeatureCommandDispatcher {
  constructor(private readonly registry: HandlerRegistry, private readonly identity: IdentityResolver) {}

  async execute(path: FeatureApiPath, context: TrustedApiRouteContext, input: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = this.registry[path]
    if (!handler) throw new Error('UNKNOWN_COMMAND_NOT_CONFIGURED')
    const organizationId = context.principal.userId === 'public-auth'
      ? 'public'
      : typeof input.organizationId === 'string' ? input.organizationId : ''
    const principal = context.principal.userId === 'public-auth'
      ? publicPrincipal()
      : await this.identity.resolve(context.principal as AuthenticatedPrincipal, organizationId)
    return handler({
      organizationId,
      principal,
      correlationId: context.correlationId,
      idempotencyKey: context.idempotencyKey,
      fingerprint: fingerprintInput(input),
    }, input)
  }
}

function publicPrincipal() {
  return {
    userId: 'public-auth',
    authenticated: false,
    tokenFresh: false,
    accountStatus: 'active' as const,
    employmentStatus: 'not_applicable' as const,
    organizationId: null,
    membershipStatus: 'not_applicable' as const,
    principalType: 'system_administrator' as const,
    clientAccountIds: [],
    stepUpSatisfied: false,
    mfaSatisfied: false,
  }
}
