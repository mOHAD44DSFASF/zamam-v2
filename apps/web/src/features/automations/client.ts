import { appCheckHeaders, auth } from '../../lib/firebase'
export interface AutomationSnapshot{automations:readonly{id:string;name:string;status:'draft'|'active'|'paused'|'archived';triggerType:string;definitionVersion:number;actionCount:number;version:number}[];runs:readonly{id:string;automationId:string;status:string;attemptCount:number;startedAt:string|null;completedAt:string|null;errorCode:string|null}[];capabilities:{create:boolean;manage:boolean;publish:boolean;cancel:boolean};limits:{maxActions:number;maxDepth:number;hourlyRuns:number}}
export interface AutomationClient{load(organizationId:string):Promise<AutomationSnapshot>;setStatus(organizationId:string,input:{automationId:string;expectedVersion:number;status:'active'|'paused'}):Promise<void>}
async function post<T>(path:string,body:unknown):Promise<T>{const baseUrl=import.meta.env.VITE_API_BASE_URL;const user=auth.currentUser;if(!baseUrl||!user)throw new Error('BACKEND_NOT_CONFIGURED');const response=await fetch(`${baseUrl}${path}`,{method:'POST',headers:{authorization:`Bearer ${await user.getIdToken()}`,'content-type':'application/json','x-correlation-id':crypto.randomUUID(),'x-idempotency-key':crypto.randomUUID(),...await appCheckHeaders()},body:JSON.stringify(body)});const envelope=await response.json()as{data?:T;error?:{code:string}};if(!response.ok||envelope.error||envelope.data===undefined)throw new Error(envelope.error?.code??'AUTOMATION_REQUEST_FAILED');return envelope.data}
interface RawAutomationRow { id?: unknown; name?: unknown; status?: unknown; triggerType?: unknown; definitionVersion?: unknown; actionCount?: unknown; version?: unknown }

/**
 * `/v1/automations/query` returns `{ items }` — raw automation docs, not the AutomationSnapshot (runs,
 * capability flags, engine limits) this screen expects. Adapter maps the real automations into a valid
 * snapshot; runs empty, capabilities fail closed, engine limits reported as the documented defaults.
 * Tracked as audit M1/M2.
 */
function toAutomationSnapshot(raw:{items?:readonly RawAutomationRow[];capabilities?:AutomationSnapshot['capabilities']}):AutomationSnapshot{
  const automations=(raw.items??[]).map((row)=>({
    id:String(row.id??''),name:typeof row.name==='string'?row.name:'',
    status:(typeof row.status==='string'?row.status:'draft') as AutomationSnapshot['automations'][number]['status'],
    triggerType:typeof row.triggerType==='string'?row.triggerType:'',
    definitionVersion:typeof row.definitionVersion==='number'?row.definitionVersion:1,
    actionCount:typeof row.actionCount==='number'?row.actionCount:0,
    version:typeof row.version==='number'?row.version:1,
  }))
  return {automations,runs:[],capabilities:raw.capabilities??{create:false,manage:false,publish:false,cancel:false},limits:{maxActions:0,maxDepth:0,hourlyRuns:0}}
}
export const automationClient:AutomationClient={load:async organizationId=>toAutomationSnapshot(await post('/v1/automations/query',{organizationId,limit:50})),setStatus:(organizationId,input)=>post('/v1/automations/status',{organizationId,...input})}
