import type { Auth } from 'firebase-admin/auth'
import type { Firestore } from 'firebase-admin/firestore'
import type { AuthorizationPrincipal } from '@zamam/authorization'
import type { AuthenticatedPrincipal } from '@zamam/contracts'

const TOKEN_FRESHNESS_MS = 60 * 60_000
const STEP_UP_FRESHNESS_MS = 5 * 60_000

export interface IdentityResolver {
  resolve(principal: AuthenticatedPrincipal, organizationId: string, now?: Date): Promise<AuthorizationPrincipal>
}

const membershipStatusMap: Record<string, AuthorizationPrincipal['membershipStatus']> = {
  active: 'active', suspended: 'suspended', left: 'left', invited: 'not_applicable',
}
const employmentStatusMap: Record<string, AuthorizationPrincipal['employmentStatus']> = {
  active: 'active', on_leave: 'leave', ended: 'ended',
}
const contactMembershipStatusMap: Record<string, AuthorizationPrincipal['membershipStatus']> = {
  active: 'active', disabled: 'suspended',
}

export class FirestoreIdentityResolver implements IdentityResolver {
  constructor(private readonly firestore: Firestore, private readonly auth: Auth) {}

  async resolve(principal: AuthenticatedPrincipal, organizationId: string, now: Date = new Date()): Promise<AuthorizationPrincipal> {
    const [authUser, membershipSnapshot, employmentSnapshot] = await Promise.all([
      this.auth.getUser(principal.userId).catch(() => null),
      this.firestore.doc(`v2Organizations/${organizationId}/organization_membership/${principal.userId}`).get(),
      this.firestore.doc(`v2Organizations/${organizationId}/employment_profile/${principal.userId}`).get(),
    ])
    const accountStatus: AuthorizationPrincipal['accountStatus'] = !authUser ? 'disabled' : authUser.disabled ? 'disabled' : 'active'
    const membership = membershipSnapshot.exists ? membershipSnapshot.data() : null
    const employment = employmentSnapshot.exists ? employmentSnapshot.data() : null
    const ageMs = now.getTime() - principal.tokenIssuedAt * 1000
    const base = {
      userId: principal.userId,
      authenticated: true,
      tokenFresh: ageMs >= 0 && ageMs < TOKEN_FRESHNESS_MS,
      accountStatus,
      organizationId,
      stepUpSatisfied: ageMs >= 0 && ageMs < STEP_UP_FRESHNESS_MS,
      mfaSatisfied: (authUser?.multiFactor?.enrolledFactors.length ?? 0) > 0,
    }
    if (membership) {
      return {
        ...base,
        principalType: 'member',
        membershipStatus: membershipStatusMap[String(membership.status)] ?? 'not_applicable',
        employmentStatus: employment ? employmentStatusMap[String(employment.status)] ?? 'not_applicable' : 'not_applicable',
        clientAccountIds: [],
      }
    }
    const contactQuery = await this.firestore
      .collection(`v2Organizations/${organizationId}/client_contact`)
      .where('userId', '==', principal.userId)
      .limit(1)
      .get()
    const contact = contactQuery.docs[0]?.data() ?? null
    return {
      ...base,
      principalType: 'client',
      membershipStatus: contact ? contactMembershipStatusMap[String(contact.portalStatus)] ?? 'not_applicable' : 'not_applicable',
      employmentStatus: 'not_applicable',
      clientAccountIds: contact ? [String(contact.clientId)] : [],
    }
  }
}
