import type { Firestore, Query } from 'firebase-admin/firestore'
import type { PageQuery, PageResult, QueryStore, StoredDocument } from './repository.js'
import { decodeValue } from './schema.js'

function applyFilters(query: Query, filters: PageQuery['filters']) {
  let next = query
  for (const filter of filters ?? []) next = next.where(filter.field, filter.operator, filter.value)
  return next
}

function applyOrder(query: Query, orderBy: PageQuery['orderBy']) {
  let next = query
  for (const clause of orderBy) next = next.orderBy(clause.field, clause.direction)
  return next
}

function encodeCursor(values: readonly unknown[]): readonly unknown[] {
  return values.map((value) => (value && typeof value === 'object' && 'toDate' in value
    ? (value as { toDate(): Date }).toDate().toISOString()
    : value))
}

export class FirestorePageQueryStore implements QueryStore {
  constructor(private readonly firestore: Firestore) {}

  async list<T>(path: string, query: PageQuery): Promise<PageResult<T>> {
    let built = applyOrder(applyFilters(this.firestore.collection(path), query.filters), query.orderBy)
    if (query.cursor?.length) built = built.startAfter(...query.cursor)
    built = built.limit(query.limit)
    const snapshot = await built.get()
    // Same Timestamp-decoding contract as FirebaseAtomicStore.get() — a query result must never hand a
    // caller a raw Firestore Timestamp for a field the rest of the codebase treats as an ISO string.
    const items = snapshot.docs.map((doc) => ({ id: doc.id, ...decodeValue(doc.data()) as StoredDocument } as unknown as T))
    const last = snapshot.docs.at(-1)
    const nextCursor = last && snapshot.size === query.limit
      ? encodeCursor(query.orderBy.map((clause) => (last.data() as StoredDocument)[clause.field]))
      : null
    return { items, nextCursor }
  }
}
