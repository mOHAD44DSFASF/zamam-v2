import type { AuthorizationPrincipal, AuthorizationRequest } from '@zamam/authorization'
import { SCHEMA_VERSION } from '@zamam/domain'
import { SERVER_TIMESTAMP, tenantDocumentPath, type AtomicStore, type StoredDocument } from '@zamam/firestore'
import { z } from 'zod'
import { AuditCommandService } from '../audit/service.js'

const id=z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)
const requestSchema=z.object({id,projectId:id,subject:z.string().trim().min(3).max(160),description:z.string().trim().min(5).max(5000)}).strict()
export interface PortalGate { require(principal:AuthorizationPrincipal,request:AuthorizationRequest):Promise<unknown> }
export interface PortalDataPort {
  contactForUser(organizationId:string,userId:string):Promise<StoredDocument|null>
  projectMemberships(organizationId:string,userId:string):Promise<readonly StoredDocument[]>
  projects(organizationId:string,projectIds:readonly string[]):Promise<readonly StoredDocument[]>
  projectItems(organizationId:string,projectId:string):Promise<{tasks:readonly StoredDocument[];comments:readonly StoredDocument[];files:readonly StoredDocument[];approvals:readonly StoredDocument[];deliveries:readonly StoredDocument[]}>
}
export interface PortalMetadata { organizationId:string;principal:AuthorizationPrincipal;correlationId:string;idempotencyKey:string;fingerprint:string }
const text=(value:unknown)=>typeof value==='string'?value:''
const iso=(value:unknown)=>typeof value==='string'?value:null
export class PortalService {
  private readonly audit:AuditCommandService
  constructor(private readonly store:AtomicStore,private readonly gate:PortalGate,private readonly data:PortalDataPort,audit?:AuditCommandService){this.audit=audit??new AuditCommandService(store)}
  private async identity(metadata:PortalMetadata){
    const p=metadata.principal
    if(p.principalType!=='client'||p.organizationId!==metadata.organizationId||p.accountStatus!=='active'||p.membershipStatus!=='active'||!p.tokenFresh)throw new Error('PORTAL_IDENTITY_DENIED')
    const contact=await this.data.contactForUser(metadata.organizationId,p.userId)
    if(!contact||contact.organizationId!==metadata.organizationId||contact.portalStatus!=='active'||!p.clientAccountIds.includes(text(contact.clientId)))throw new Error('PORTAL_MEMBERSHIP_DENIED')
    return{clientId:text(contact.clientId),contactId:text(contact.id)}
  }
  private async memberProjects(metadata:PortalMetadata,clientId:string){
    const memberships=(await this.data.projectMemberships(metadata.organizationId,metadata.principal.userId)).filter(m=>m.organizationId===metadata.organizationId&&m.principalType==='client'&&m.status==='active'&&m.access==='viewer')
    const ids=[...new Set(memberships.map(m=>text(m.projectId)).filter(Boolean))].slice(0,50)
    const projects=await this.data.projects(metadata.organizationId,ids)
    return projects.filter(p=>p.organizationId===metadata.organizationId&&p.clientId===clientId&&p.clientVisible===true&&ids.includes(text(p.id))).map(p=>({id:text(p.id),name:text(p.name),code:text(p.code),status:text(p.status),startsOn:iso(p.startsOn),dueOn:iso(p.dueOn)}))
  }
  async dashboard(metadata:PortalMetadata){
    const identity=await this.identity(metadata)
    await this.gate.require(metadata.principal,{permission:'portal.view',organizationId:metadata.organizationId,resource:{type:'client',id:identity.clientId,organizationId:metadata.organizationId,clientAccountId:identity.clientId,visibility:'client'}})
    const projects=await this.memberProjects(metadata,identity.clientId)
    const pending=[] as {id:string;projectId:string;title:string;reviewedVersion:number;dueAt:string|null}[]
    const deliveries=[] as {id:string;projectId:string;title:string;deliveredAt:string|null}[]
    for(const project of projects){const items=await this.data.projectItems(metadata.organizationId,project.id);for(const approval of items.approvals){if(approval.organizationId===metadata.organizationId&&approval.visibility==='client'&&approval.reviewerUserId===metadata.principal.userId&&approval.status==='pending')pending.push({id:text(approval.id),projectId:project.id,title:text(approval.title),reviewedVersion:Number(approval.reviewedVersion),dueAt:iso(approval.dueAt)})}for(const delivery of items.deliveries){if(delivery.organizationId===metadata.organizationId&&delivery.clientId===identity.clientId&&delivery.status==='available')deliveries.push({id:text(delivery.id),projectId:project.id,title:text(delivery.title),deliveredAt:iso(delivery.deliveredAt)})}}
    return{clientId:identity.clientId,projects,pendingApprovals:pending.slice(0,50),deliveries:deliveries.slice(0,50)}
  }
  async project(metadata:PortalMetadata,projectId:string){
    id.parse(projectId);const identity=await this.identity(metadata);const projects=await this.memberProjects(metadata,identity.clientId);const project=projects.find(item=>item.id===projectId);if(!project)throw new Error('PORTAL_PROJECT_DENIED')
    await this.gate.require(metadata.principal,{permission:'portal.view',organizationId:metadata.organizationId,resource:{type:'project',id:projectId,projectId,organizationId:metadata.organizationId,clientAccountId:identity.clientId,visibility:'client'}})
    const items=await this.data.projectItems(metadata.organizationId,projectId)
    return{project,tasks:items.tasks.filter(item=>item.organizationId===metadata.organizationId&&item.projectId===projectId&&item.clientVisible===true).slice(0,100).map(item=>({id:text(item.id),title:text(item.title),status:text(item.status),dueAt:iso(item.dueAt)})),comments:items.comments.filter(item=>item.organizationId===metadata.organizationId&&item.resourceType==='project'&&item.resourceId===projectId&&item.visibility==='client'&&item.status==='active').slice(0,100).map(item=>({id:text(item.id),body:text(item.body),createdAt:iso(item.createdAt)})),files:items.files.filter(item=>item.organizationId===metadata.organizationId&&item.resourceType==='project'&&item.resourceId===projectId&&item.visibility==='client'&&item.status==='available'&&item.retentionState==='active').slice(0,100).map(item=>({id:text(item.id),displayName:text(item.displayName),latestVersionNumber:Number(item.latestVersionNumber)}))}
  }
  async createRequest(metadata:PortalMetadata,raw:z.input<typeof requestSchema>){
    const input=requestSchema.parse(raw);const identity=await this.identity(metadata);const projects=await this.memberProjects(metadata,identity.clientId);if(!projects.some(p=>p.id===input.projectId))throw new Error('PORTAL_PROJECT_DENIED')
    await this.gate.require(metadata.principal,{permission:'portal.request.create',organizationId:metadata.organizationId,resource:{type:'project',id:input.projectId,projectId:input.projectId,organizationId:metadata.organizationId,clientAccountId:identity.clientId,visibility:'client'}})
    const context={organizationId:metadata.organizationId,actorUserId:metadata.principal.userId,permission:'portal.request.create' as const,correlationId:metadata.correlationId,idempotencyKey:metadata.idempotencyKey,fingerprint:metadata.fingerprint}
    return this.audit.execute(context,async transaction=>{const path=tenantDocumentPath(metadata.organizationId,'client_request',input.id);if(await transaction.get(path))throw new Error('ENTITY_ALREADY_EXISTS');transaction.create(path,{organizationId:metadata.organizationId,schemaVersion:SCHEMA_VERSION,version:1,createdAt:SERVER_TIMESTAMP,updatedAt:SERVER_TIMESTAMP,clientId:identity.clientId,projectId:input.projectId,requestedBy:metadata.principal.userId,subject:input.subject,description:input.description,status:'open'});return{result:{requestId:input.id,status:'open' as const,version:1},resourceType:'client_request',resourceId:input.id,outbox:{type:'client.request_created',version:1,payload:{requestId:input.id,projectId:input.projectId,clientId:identity.clientId}}}})
  }
}
