import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { FirebaseAtomicStore, FirestorePageQueryStore } from '../packages/firestore/src'

const SAMPLE_AT = new Date('2026-01-01T00:00:00.000Z')
const NESTED_AT = new Date('2026-01-02T00:00:00.000Z')
const ARRAY_AT = new Date('2026-01-03T00:00:00.000Z')

function sampleData() {
  return {
    title: 'Task', version: 1,
    updatedAt: Timestamp.fromDate(SAMPLE_AT),
    stageDueAt: Timestamp.fromDate(NESTED_AT),
    reasons: ['unknown_assignee', Timestamp.fromDate(ARRAY_AT)],
    nested: { dueAt: Timestamp.fromDate(NESTED_AT) },
  }
}

describe('FirebaseAtomicStore decodes Firestore Timestamp fields (GAP 3 regression)', () => {
  it('returns ISO strings, not raw Timestamp instances, for every date-like field read through a transaction', async () => {
    const fakeFirestore = {
      doc: (path: string) => ({ __path: path }),
      runTransaction: async (fn: (transaction: unknown) => Promise<unknown>) => fn({
        get: async (ref: { __path: string }) => ({ exists: true, data: () => sampleData(), __path: ref.__path }),
      }),
    } as unknown as import('firebase-admin/firestore').Firestore

    const store = new FirebaseAtomicStore(fakeFirestore)
    const record = await store.runTransaction((transaction) => transaction.get('v2Organizations/org-1/task/task-1'))

    expect(record).not.toBeNull()
    // This is exactly the bug: before the fix, these fields were Timestamp instances and
    // Date.parse(String(...)) on them produced NaN, silently breaking SLA/retention/edit-window checks
    // that read a record straight from a real Firestore transaction.
    expect(typeof record!.updatedAt).toBe('string')
    expect(Number.isNaN(Date.parse(String(record!.updatedAt)))).toBe(false)
    expect(record!.updatedAt).toBe(SAMPLE_AT.toISOString())
    expect(record!.stageDueAt).toBe(NESTED_AT.toISOString())
    expect((record!.nested as Record<string, unknown>).dueAt).toBe(NESTED_AT.toISOString())
    expect((record!.reasons as unknown[])[1]).toBe(ARRAY_AT.toISOString())
  })

  it('returns null for a document that does not exist, without attempting to decode anything', async () => {
    const fakeFirestore = {
      doc: () => ({}),
      runTransaction: async (fn: (transaction: unknown) => Promise<unknown>) => fn({
        get: async () => ({ exists: false, data: () => undefined }),
      }),
    } as unknown as import('firebase-admin/firestore').Firestore
    const store = new FirebaseAtomicStore(fakeFirestore)
    expect(await store.runTransaction((transaction) => transaction.get('v2Organizations/org-1/task/missing'))).toBeNull()
  })
})

describe('FirestorePageQueryStore decodes Firestore Timestamp fields in query results (GAP 3 regression)', () => {
  it('returns ISO strings for date-like fields on every item in a query page', async () => {
    const chain = {
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      startAfter: () => chain,
      get: async () => ({
        docs: [{ id: 'task-1', data: () => sampleData() }],
        size: 1,
      }),
    }
    const fakeFirestore = { collection: () => chain } as unknown as import('firebase-admin/firestore').Firestore
    const store = new FirestorePageQueryStore(fakeFirestore)
    const page = await store.list<Record<string, unknown>>('v2Organizations/org-1/task', {
      organizationId: 'org-1', entityKind: 'task', orderBy: [{ field: 'updatedAt', direction: 'desc' }], limit: 50,
    })
    expect(page.items).toHaveLength(1)
    const item = page.items[0]!
    expect(typeof item.updatedAt).toBe('string')
    expect(Number.isNaN(Date.parse(String(item.updatedAt)))).toBe(false)
    expect(item.updatedAt).toBe(SAMPLE_AT.toISOString())
    expect((item.nested as Record<string, unknown>).dueAt).toBe(NESTED_AT.toISOString())
  })
})
