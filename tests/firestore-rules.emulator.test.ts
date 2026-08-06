import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, setDoc, collection } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let environment: RulesTestEnvironment

/**
 * This suite calls environment.clearFirestore() before every test — safe only against an emulator that
 * `firebase emulators:exec` spun up just for this run and will tear down afterward, catastrophic against
 * a developer's long-running manual-testing emulator (it wiped org-demo's bootstrap data once already,
 * see docs/v2/LOCAL_DEVELOPMENT.md "Emulator data loss incident"). `emulators:exec` sets
 * FIREBASE_EMULATOR_HUB in the child process env; a bare `npm run test:rules` (or this file run directly)
 * does not. Refuse to run rather than risk clearing someone else's data — use `npm run test:emulator`.
 */
beforeAll(async () => {
  if (!process.env.FIREBASE_EMULATOR_HUB) {
    throw new Error(
      'REFUSING TO RUN: this suite calls clearFirestore() every test, which would wipe any Firestore ' +
      'emulator already running on this machine (e.g. a developer\'s manual-testing environment) — it must ' +
      'only run inside an emulator `firebase emulators:exec` started just for this test run. ' +
      'Run `npm run test:emulator` instead of `npm run test:rules`/`vitest run --config vitest.emulator.config.ts` directly.',
    )
  }
  environment = await initializeTestEnvironment({
    projectId: 'zamam-emulator',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

afterAll(async () => environment?.cleanup())
beforeEach(async () => {
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'sessionViews/user-1'), {
      accountStatus: 'active', memberships: [{ organizationId: 'org-1', status: 'active' }],
    })
    await setDoc(doc(context.firestore(), 'v2Organizations/org-1/task/task-1'), {
      organizationId: 'org-1', schemaVersion: 2, title: 'Sensitive task',
    })
    await setDoc(doc(context.firestore(), 'v2Organizations/org-1/workspace/workspace-1'), {
      organizationId: 'org-1', schemaVersion: 2, name: 'Sensitive workspace',
    })
  })
})

describe('Firestore authorization mutations', () => {
  it('allows an authenticated user to get only their own session view', async () => {
    const user = environment.authenticatedContext('user-1').firestore()
    await assertSucceeds(getDoc(doc(user, 'sessionViews/user-1')))
    await assertFails(getDoc(doc(user, 'sessionViews/user-2')))
    await assertFails(getDocs(collection(user, 'sessionViews')))
  })

  it('denies anonymous reads', async () => {
    const anonymous = environment.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(anonymous, 'sessionViews/user-1')))
  })

  it('denies all client writes including self session mutation', async () => {
    const user = environment.authenticatedContext('user-1').firestore()
    await assertFails(setDoc(doc(user, 'sessionViews/user-1'), { accountStatus: 'active' }))
    await assertFails(setDoc(doc(user, 'v2Organizations/org-1/task/task-2'), { organizationId: 'org-1' }))
  })

  it('does not trust client role or permission claims for tenant data', async () => {
    const forged = environment.authenticatedContext('user-1', {
      role: 'Owner', permissions: ['task.view_all', 'role.manage'], organizationId: 'org-1',
    }).firestore()
    await assertFails(getDoc(doc(forged, 'v2Organizations/org-1/task/task-1')))
    await assertFails(getDoc(doc(forged, 'v2Organizations/org-2/task/task-1')))
  })

  it('requires workspace data to pass through the trusted backend', async () => {
    const forged = environment.authenticatedContext('user-1', {
      organizationId: 'org-1', workspaceIds: ['workspace-1'], role: 'Owner',
    }).firestore()
    await assertFails(getDoc(doc(forged, 'v2Organizations/org-1/workspace/workspace-1')))
    await assertFails(setDoc(doc(forged, 'v2Organizations/org-1/workspace_member/fake'), {
      organizationId: 'org-1', workspaceId: 'workspace-1', userId: 'user-1', status: 'active',
    }))
  })
})
