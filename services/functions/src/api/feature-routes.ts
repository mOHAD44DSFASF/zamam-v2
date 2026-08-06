import type { TrustedApiRoute, TrustedApiRouteContext } from './api.js'
import { z } from 'zod'

const organizationCommand=z.object({organizationId:z.string().regex(/^[A-Za-z0-9_-]{2,128}$/)}).passthrough()
const publicSchemas={
  '/v1/auth/password-reset':z.object({email:z.string().email().max(254)}).strict(),
  '/v1/auth/invitations/accept':z.object({invitationToken:z.string().regex(/^[A-Za-z0-9_-]{32,512}$/),password:z.string().min(12).max(128),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)}).strict(),
} as const
export const FEATURE_API_PATHS=[
  '/v1/auth/invitations/accept','/v1/auth/password-reset',
  '/v1/organization/directory/query','/v1/organization/departments/create','/v1/organization/teams/create',
  '/v1/employees/query','/v1/employees/invite','/v1/employees/disable',
  '/v1/clients/query','/v1/clients/create','/v1/clients/transition','/v1/clients/contacts/create','/v1/clients/contacts/eligibility',
  '/v1/projects/query','/v1/projects/create','/v1/projects/transition','/v1/projects/client-visibility',
  '/v1/workspaces/query','/v1/workspaces/create',
  '/v1/tasks/query','/v1/tasks/create','/v1/tasks/update','/v1/tasks/complete-step','/v1/tasks/send-back-step','/v1/task-views/create','/v1/workflows/instances/transition',
  '/v1/workflows/builder/query','/v1/workflows/drafts/update','/v1/workflows/simulate','/v1/workflows/publish',
  '/v1/reviews/inbox','/v1/reviews/decide',
  '/v1/templates/query','/v1/templates/create','/v1/templates/publish','/v1/recurrences/status',
  '/v1/collaboration/query','/v1/comments/create','/v1/comments/delete','/v1/reactions/set','/v1/tasks/watch',
  '/v1/files/query','/v1/files/upload/prepare','/v1/files/upload/finalize','/v1/files/delete','/v1/files/download',
  '/v1/notifications/query','/v1/notifications/status','/v1/notifications/preferences/update',
  '/v1/workload/query','/v1/workload/rebuild',
  '/v1/time/query','/v1/time/timer/start','/v1/time/timer/stop','/v1/time/entries/create','/v1/timesheets/submit','/v1/timesheets/decide',
  '/v1/attendance/overview','/v1/attendance/record','/v1/leave/request','/v1/leave/decide',
  '/v1/reports/query','/v1/reports/export',
  '/v1/automations/query','/v1/automations/status',
  '/v1/ai/query','/v1/ai/request','/v1/ai/proposals/decide',
  '/v1/portal/dashboard','/v1/portal/projects/get','/v1/portal/requests/create','/v1/portal/approvals/decide','/v1/portal/files/download',
] as const
export type FeatureApiPath=typeof FEATURE_API_PATHS[number]
export interface FeatureCommandDispatcher{execute(path:FeatureApiPath,context:TrustedApiRouteContext,input:Readonly<Record<string,unknown>>):Promise<unknown>}
const operation=(path:FeatureApiPath)=>path.slice(4).replaceAll('/','.')
export function createFeatureRoutes(dispatcher:FeatureCommandDispatcher):Readonly<Record<string,TrustedApiRoute>>{
  return Object.fromEntries(FEATURE_API_PATHS.map(path=>{const isPublic=path in publicSchemas;return[path,{operation:operation(path),schema:isPublic?publicSchemas[path as keyof typeof publicSchemas]:organizationCommand,rateLimit:isPublic?5:path.includes('/query')?60:20,...(isPublic?{authentication:'public' as const}:{}),handle:(context,input)=>dispatcher.execute(path,context,input as Readonly<Record<string,unknown>>)}]}))
}
export class DisabledFeatureCommandDispatcher implements FeatureCommandDispatcher{
  async execute():Promise<never>{throw new Error('FEATURE_BACKEND_NOT_COMPOSED')}
}
