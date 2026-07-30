import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore'
import type { AtomicStore, AtomicTransaction, StoredDocument } from './repository.js'

function materialize(value: unknown): unknown {
  if (value && typeof value === 'object' && '__serverTimestamp' in value && value.__serverTimestamp === true) {
    return FieldValue.serverTimestamp()
  }
  if (Array.isArray(value)) return value.map(materialize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, materialize(child)]))
  }
  return value
}

class FirebaseTransactionAdapter implements AtomicTransaction {
  constructor(private readonly firestore: Firestore, private readonly transaction: Transaction) {}
  async get(path: string) {
    const snapshot = await this.transaction.get(this.firestore.doc(path))
    return snapshot.exists ? snapshot.data() as StoredDocument : null
  }
  create(path: string, data: StoredDocument) {
    this.transaction.create(this.firestore.doc(path), materialize(data) as FirebaseFirestore.DocumentData)
  }
  update(path: string, data: StoredDocument) {
    this.transaction.update(this.firestore.doc(path), materialize(data) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>)
  }
}

export class FirebaseAtomicStore implements AtomicStore {
  constructor(private readonly firestore: Firestore) {}
  runTransaction<TResult>(operation: (transaction: AtomicTransaction) => Promise<TResult>) {
    return this.firestore.runTransaction((transaction) => operation(new FirebaseTransactionAdapter(this.firestore, transaction)))
  }
}
