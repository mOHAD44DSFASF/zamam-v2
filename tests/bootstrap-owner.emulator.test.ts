import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FirebaseAtomicStore } from '@zamam/firestore'
import { BootstrapOwnerService, type OwnerIdentityPort } from '../services/functions/src/organization/bootstrap-service'

function identities(userId: string): OwnerIdentityPort {
  return {
    provisionInvitation: async () => ({ userId, created: true }),
    setPassword: async () => undefined,
  }
}

const input = {
  organizationId: 'org-emulator-1', organizationName: 'Emulator Org', organizationSlug: 'emulator-org',
  ownerEmail: 'owner@emulator.local', ownerDisplayName: 'Emulator Owner', ownerFirstName: 'Emulator',
  ownerPassword: 'a-very-strong-password-1',
}

let firestore: Firestore

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: 'zamam-emulator' })
  firestore = getFirestore()
})

afterAll(async () => firestore.terminate())

describe('BootstrapOwnerService against a real Firestore transaction', () => {
  // This is the regression test for "Firestore transactions require all reads to be executed before all
  // writes": FirebaseAtomicStore runs BootstrapOwnerService's transaction against the real Admin SDK
  // transaction API (via the Firestore emulator), which enforces that rule for real — a Map-backed fake
  // would not. An interleaved get/create per entity (the original bug) fails here with exactly the error
  // reported in production; the fixed read-phase-then-write-phase structure does not.
  it('bootstraps end-to-end, and is idempotent on a second run, without violating read/write ordering', async () => {
    const store = new FirebaseAtomicStore(firestore)
    const service = new BootstrapOwnerService(store, identities('owner-emulator-1'))

    const first = await service.bootstrap(input)
    expect(first.actions).toEqual({
      organizationCreated: true, departmentCreated: true, membershipCreated: true,
      employmentCreated: true, roleCreated: true, roleAssignmentCreated: true, passwordSet: true,
    })

    const second = await service.bootstrap(input)
    expect(second.actions).toEqual({
      organizationCreated: false, departmentCreated: false, membershipCreated: false,
      employmentCreated: false, roleCreated: false, roleAssignmentCreated: false, passwordSet: true,
    })
  })
})
