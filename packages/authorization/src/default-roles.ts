import { PERMISSIONS, type Permission } from './catalog.js'
import type { TrustedRole } from './types.js'

export type DefaultRoleName = 'Owner' | 'GeneralManager' | 'DeputyManager' | 'DepartmentManager' | 'TeamLeader' | 'Supervisor' | 'Employee' | 'Contractor' | 'Client' | 'SystemAdministrator'

const basic: Permission[] = ['organization.view', 'team.view', 'user.view', 'project.view', 'workspace.view', 'task.view', 'file.view', 'file.download', 'notification.view', 'saved_view.create', 'search.use']
const selfService: Permission[] = ['time.track', 'time.view_self', 'timesheet.submit', 'attendance.view_self', 'attendance.record', 'leave.view_self', 'leave.request', 'workload.view_self', 'report.view_self', 'kpi.view_self']
const taskExecutor: Permission[] = ['task.update', 'task.claim', 'task.transition', 'task.watch', 'subtask.manage', 'checklist.update', 'file.upload', 'file.download', 'file.version', 'file.delete', 'file.restore', 'comment.internal.view', 'comment.internal.create', 'comment.internal.update', 'comment.internal.delete', 'mention.create', 'reaction.create', 'reaction.delete', 'activity.view']
const teamOperations: Permission[] = ['team.view', 'team.manage', 'membership.view', 'task.view_all', 'task.create', 'task.assign', 'task.reassign', 'review.perform', 'workload.view_team', 'report.view_team', 'time.view_team', 'attendance.view_team', 'leave.view_team']
const clientPortal: Permission[] = ['organization.view', 'client.view', 'portal.view', 'portal.request.create', 'portal.delivery.download', 'project.view', 'task.view', 'task.approve', 'task.watch', 'comment.client.view', 'comment.client.create', 'comment.client.update', 'comment.client.delete', 'mention.create', 'reaction.create', 'reaction.delete', 'activity.view', 'file.view', 'file.upload', 'file.download', 'file.version', 'file.delete', 'notification.view', 'notification.manage_preferences']
const platform: Permission[] = PERMISSIONS.filter((permission) => permission.startsWith('platform.'))

const unique = (...sets: readonly Permission[][]) => [...new Set(sets.flat())]
const owner = PERMISSIONS.filter((permission) => !permission.startsWith('platform.'))
const governance = new Set<Permission>(['organization.suspend', 'security.policy.manage', 'audit.export', 'support.access.grant', 'role.manage', 'role.assign', 'integration.credential.rotate', 'employment.compensation.view', 'client.financial.view', 'project.financial.view', 'project.financial.manage'])
const generalManager = owner.filter((permission) => !governance.has(permission))
const departmentManager = unique(basic, selfService, taskExecutor, teamOperations, [
  'department.view', 'department.manage', 'team.create', 'team.archive', 'client.view', 'project.create', 'project.manage',
  'project.member.manage', 'workspace.create', 'workspace.manage', 'workspace.member.manage', 'task.archive', 'task.reopen', 'task.watcher.manage', 'comment.moderate',
  'template.view', 'template.create', 'template.manage', 'recurrence.manage',
  'workflow.view', 'workflow.create', 'workflow.manage', 'review.request', 'review.cancel', 'change_request.resolve',
  'report.view_department', 'goal.view', 'goal.manage', 'kpi.view_team',
])

export function createDefaultRoles(organizationId: string, policyVersion = 1): Readonly<Record<DefaultRoleName, TrustedRole>> {
  const role = (name: DefaultRoleName, permissions: readonly Permission[], platformRole = false): TrustedRole => ({
    id: `default:${name}`, organizationId: platformRole ? null : organizationId, name, permissions, status: 'active', policyVersion,
  })
  return {
    Owner: role('Owner', owner),
    GeneralManager: role('GeneralManager', generalManager),
    DeputyManager: role('DeputyManager', ['organization.view']),
    DepartmentManager: role('DepartmentManager', departmentManager),
    TeamLeader: role('TeamLeader', unique(basic, selfService, taskExecutor, teamOperations)),
    Supervisor: role('Supervisor', unique(basic, selfService, taskExecutor, ['task.view_all', 'task.assign', 'review.perform', 'project.view', 'workspace.view'])),
    Employee: role('Employee', unique(basic, selfService, taskExecutor)),
    Contractor: role('Contractor', ['project.view', 'workspace.view', 'task.view', 'task.update', 'task.transition', 'task.watch', 'checklist.update', 'file.view', 'file.upload', 'file.download', 'file.version', 'file.delete', 'file.restore', 'comment.internal.view', 'comment.internal.create', 'comment.internal.update', 'comment.internal.delete', 'mention.create', 'reaction.create', 'reaction.delete', 'activity.view', 'time.track', 'time.view_self']),
    Client: role('Client', clientPortal),
    SystemAdministrator: role('SystemAdministrator', platform, true),
  }
}
