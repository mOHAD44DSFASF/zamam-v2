import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { aiContentHash, aiProposalHash, assertAIContentSafe, redactAIText, SCHEMA_VERSION } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type StoredDocument } from '@zamam/firestore'
import { z } from 'zod'
import { Timestamp } from 'firebase-admin/firestore'
import { AuditCommandService } from '../audit/service.js'
const id=z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const requestSchema=z.object({id,purpose:z.enum(['summarize','draft','suggest_actions']),content:z.string().min(1).max(20_000),classification:z.enum(['operational_public','internal','client_confidential','hr_sensitive','financial_sensitive'])}).strict()
export interface AIPolicyPort { policy(organizationId:string):Promise<{enabled:boolean;allowedClassifications:readonly string[];modelPolicyId:string;maxRequestsPerHour:number;retentionHours?:number}>; consumeQuota(organizationId:string,userId:string,limit:number):Promise<boolean> }
export interface AIGate { require(principal:AuthorizationPrincipal,request:AuthorizationRequest):Promise<unknown> }
export interface AILookup { getProposal(organizationId:string,proposalId:string):Promise<StoredDocument|null> }
export interface AIMetadata { organizationId:string;principal:AuthorizationPrincipal;correlationId:string;idempotencyKey:string;fingerprint:string }
export class AIService {
  private readonly audit:AuditCommandService
  constructor(private readonly store:AtomicStore,private readonly gate:AIGate,private readonly policy:AIPolicyPort,private readonly lookup:AILookup,audit?:AuditCommandService,private readonly now:()=>Date=()=>new Date()){this.audit=audit??new AuditCommandService(store)}
  async request(metadata:AIMetadata,raw:z.input<typeof requestSchema>){
    const input=requestSchema.parse(raw); const policy=await this.policy.policy(metadata.organizationId)
    if(!policy.enabled) throw new Error('AI_DISABLED')
    if(!policy.allowedClassifications.includes(input.classification)) throw new Error('AI_CLASSIFICATION_DENIED')
    if(!await this.policy.consumeQuota(metadata.organizationId,metadata.principal.userId,policy.maxRequestsPerHour)) throw new Error('AI_QUOTA_EXCEEDED')
    await this.gate.require(metadata.principal,{permission:'ai.use',organizationId:metadata.organizationId,resource:{type:'organization',id:metadata.organizationId,organizationId:metadata.organizationId,visibility:'restricted'}})
    const redacted=redactAIText(input.content); assertAIContentSafe(redacted); const promptHash=await aiContentHash(redacted)
    const context={organizationId:metadata.organizationId,actorUserId:metadata.principal.userId,permission:'ai.use' as const,correlationId:metadata.correlationId,idempotencyKey:metadata.idempotencyKey,fingerprint:metadata.fingerprint}
    const retentionHours=policy.retentionHours??72;if(!Number.isInteger(retentionHours)||retentionHours<1||retentionHours>168)throw new Error('AI_RETENTION_POLICY_INVALID');const expiresAt=Timestamp.fromMillis(this.now().getTime()+retentionHours*3_600_000)
    return this.audit.execute(context,async(transaction)=>{transaction.create(tenantDocumentPath(metadata.organizationId,'ai_request',input.id),{organizationId:metadata.organizationId,schemaVersion:SCHEMA_VERSION,version:1,createdAt:SERVER_TIMESTAMP,updatedAt:SERVER_TIMESTAMP,requestedBy:metadata.principal.userId,purpose:input.purpose,modelPolicyId:policy.modelPolicyId,status:'queued',promptHash,classification:input.classification,expiresAt});return{result:{requestId:input.id,status:'queued' as const,version:1},resourceType:'ai_request',resourceId:input.id,outbox:{type:'ai.requested',version:1,payload:{aiRequestId:input.id,purpose:input.purpose,redactedContent:redacted,promptHash,modelPolicyId:policy.modelPolicyId}}}})
  }
  async decideProposal(metadata:AIMetadata,proposalId:string,expectedVersion:number,decision:'approved'|'rejected',expectedHash:string){
    id.parse(proposalId);const proposal=await this.lookup.getProposal(metadata.organizationId,proposalId);if(!proposal)throw new Error('ENTITY_NOT_FOUND');if(proposal.status!=='proposed')throw new Error('AI_PROPOSAL_NOT_PENDING');if(proposal.argumentsHash!==expectedHash)throw new Error('AI_PROPOSAL_HASH_MISMATCH');if(expectedHash!==await aiProposalHash(String(proposal.actionType),proposal.arguments as Record<string,string>))throw new Error('AI_PROPOSAL_EVIDENCE_INVALID')
    await this.gate.require(metadata.principal,{permission:'ai.action.approve',organizationId:metadata.organizationId,requireStepUp:true,resource:{type:String(proposal.resourceType??'organization'),id:String(proposal.resourceId??metadata.organizationId),organizationId:metadata.organizationId,visibility:'restricted'}})
    const context={organizationId:metadata.organizationId,actorUserId:metadata.principal.userId,permission:'ai.action.approve' as const,correlationId:metadata.correlationId,idempotencyKey:metadata.idempotencyKey,fingerprint:metadata.fingerprint}
    return this.audit.execute(context,async(transaction)=>{const path=tenantDocumentPath(metadata.organizationId,'ai_action_proposal',proposalId);const current=await transaction.get(path);if(!current||current.version!==expectedVersion)throw new Error('VERSION_CONFLICT');transaction.update(path,{status:decision,...(decision==='approved'?{approvedBy:metadata.principal.userId}:{rejectedBy:metadata.principal.userId}),version:expectedVersion+1,updatedAt:SERVER_TIMESTAMP});return{result:{proposalId,status:decision,version:expectedVersion+1,executed:false},resourceType:'ai_action_proposal',resourceId:proposalId,outbox:{type:`ai.proposal_${decision}`,version:1,payload:{proposalId}}}})
  }
}
