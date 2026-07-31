import { describe, expect, it, vi } from 'vitest'
import type { AuthorizationPrincipal } from '@zamam/authorization'
import { evaluateCapabilities, resolveNames } from '../services/functions/src/api/deps'
import type { Deps } from '../services/functions/src/api/deps'

const principal = { userId: 'owner-1' } as AuthorizationPrincipal

// Minimal Deps: only the pieces the two helpers touch (authorization.evaluate, firestore.doc().get()).
function depsWith(opts: {
  allowedPermissions?: Set<string>
  docs?: Record<string, Record<string, unknown>>
}): Deps {
  const evaluate = vi.fn(async (_p: AuthorizationPrincipal, req: { permission: string }) => ({
    allowed: opts.allowedPermissions ? opts.allowedPermissions.has(req.permission) : true,
  }))
  const firestore = {
    doc: (path: string) => ({
      get: async () => {
        const data = opts.docs?.[path]
        return { exists: !!data, data: () => data }
      },
    }),
  }
  return { firestore, authorization: { evaluate } } as unknown as Deps & { authorization: { evaluate: typeof evaluate } }
}

describe('evaluateCapabilities (server-side capability composition)', () => {
  it('returns true only for permissions the authorization service allows (per resource)', async () => {
    const deps = depsWith({ allowedPermissions: new Set(['client.create', 'client.manage']) })
    const caps = await evaluateCapabilities(deps, principal, 'org-1', {
      create: 'client.create', manage: 'client.manage', manageContacts: 'client.contact.manage', archive: 'client.archive',
    })
    expect(caps).toEqual({ create: true, manage: true, manageContacts: false, archive: false })
  })

  it('an Owner (all permissions allowed) sees every capability as true', async () => {
    const deps = depsWith({}) // default allows everything
    const caps = await evaluateCapabilities(deps, principal, 'org-1', {
      invite: 'user.invite', disable: 'user.disable',
    })
    expect(caps).toEqual({ invite: true, disable: true })
  })

  it('an unauthorized user (nothing allowed) sees every capability as false', async () => {
    const deps = depsWith({ allowedPermissions: new Set() })
    const caps = await evaluateCapabilities(deps, principal, 'org-1', {
      create: 'project.create', archive: 'project.archive',
    })
    expect(caps).toEqual({ create: false, archive: false })
  })
})

describe('resolveNames (batch display-name resolution)', () => {
  it('resolves the requested field per id, de-duplicating and returning null for missing docs', async () => {
    const deps = depsWith({
      docs: {
        'v2Organizations/org-1/department/dep-1': { name: 'Executive' },
        'v2Organizations/org-1/department/dep-2': { name: 'Operations' },
      },
    })
    const names = await resolveNames(deps, 'org-1', 'department', ['dep-1', 'dep-2', 'dep-1', 'dep-missing', ''])
    expect(names.get('dep-1')).toBe('Executive')
    expect(names.get('dep-2')).toBe('Operations')
    expect(names.get('dep-missing')).toBe(null)
  })

  it('reads a custom field (e.g. displayName from user_profile)', async () => {
    const deps = depsWith({ docs: { 'v2Organizations/org-1/user_profile/u-1': { displayName: 'Zamam Owner' } } })
    const names = await resolveNames(deps, 'org-1', 'user_profile', ['u-1'], 'displayName')
    expect(names.get('u-1')).toBe('Zamam Owner')
  })
})
