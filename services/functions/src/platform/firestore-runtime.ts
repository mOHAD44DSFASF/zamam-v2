import { createHash } from 'node:crypto'
import { FieldValue,Timestamp,type Firestore } from 'firebase-admin/firestore'
import type { OutboxEvent } from '@zamam/domain'
import type { IdempotencyEntry,IdempotencyStore,OutboxPublisher,RateLimiter } from './ports.js'
const documentId=(value:string)=>createHash('sha256').update(value).digest('hex')
export class FirestoreIdempotencyStore implements IdempotencyStore{
  constructor(private readonly db:Firestore,private readonly now:()=>Date=()=>new Date()){}
  private ref(key:string){return this.db.collection('_apiIdempotency').doc(documentId(key))}
  async get(key:string){const snapshot=await this.ref(key).get();if(!snapshot.exists)return null;const data=snapshot.data()!;if(data.expiresAt instanceof Timestamp&&data.expiresAt.toMillis()<=this.now().getTime())return null;return{operation:String(data.operation),fingerprint:String(data.fingerprint),actorUserId:String(data.actorUserId),...(data.resultJson?{result:JSON.parse(String(data.resultJson))}: {})}}
  async create(key:string,entry:IdempotencyEntry){return this.db.runTransaction(async transaction=>{const ref=this.ref(key);const snapshot=await transaction.get(ref);if(snapshot.exists){const expiry=snapshot.data()?.expiresAt;if(!(expiry instanceof Timestamp)||expiry.toMillis()>this.now().getTime())return false}transaction.set(ref,{...entry,status:'processing',createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),expiresAt:Timestamp.fromMillis(this.now().getTime()+86_400_000)});return true})}
  async complete(key:string,result:unknown){await this.ref(key).update({status:'completed',resultJson:JSON.stringify(result),updatedAt:FieldValue.serverTimestamp()})}
  async remove(key:string){await this.ref(key).delete()}
}
export class FirestoreRateLimiter implements RateLimiter{
  constructor(private readonly db:Firestore,private readonly now:()=>Date=()=>new Date()){}
  async consume(key:string,limit:number,windowSeconds:number){if(limit<1||windowSeconds<1)throw new Error('INVALID_RATE_LIMIT');const ref=this.db.collection('_apiRateLimits').doc(documentId(key));return this.db.runTransaction(async transaction=>{const snapshot=await transaction.get(ref);const nowMs=this.now().getTime();const data=snapshot.data();const start=data?.windowStartedAt instanceof Timestamp?data.windowStartedAt.toMillis():0;const active=nowMs-start<windowSeconds*1000;const count=active&&typeof data?.count==='number'?data.count:0;if(count>=limit)return false;transaction.set(ref,{count:count+1,windowStartedAt:active?data!.windowStartedAt:Timestamp.fromMillis(nowMs),expiresAt:Timestamp.fromMillis(nowMs+windowSeconds*2000),updatedAt:FieldValue.serverTimestamp()});return true})}
}
export class FirestoreOutboxPublisher implements OutboxPublisher{
  constructor(private readonly db:Firestore){}
  async publish(event:OutboxEvent){const ref=this.db.collection('_apiOutbox').doc(event.id);await this.db.runTransaction(async transaction=>{if((await transaction.get(ref)).exists)return;transaction.create(ref,{...event,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()})})}
}
