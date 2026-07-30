import type { Firestore, Query } from 'firebase-admin/firestore'
import type { PageQuery, PageResult, QueryStore, StoredDocument } from './repository.js'

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
    const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as unknown as T))
    const last = snapshot.docs.at(-1)
    const nextCursor = last && snapshot.size === query.limit
      ? encodeCursor(query.orderBy.map((clause) => (last.data() as StoredDocument)[clause.field]))
      : null
    return { items, nextCursor }
  }
}
