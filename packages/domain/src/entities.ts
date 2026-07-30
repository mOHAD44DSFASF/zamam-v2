import type { ArchiveFields, GlobalEntity, TenantEntity, UtcIsoString } from './base.js'
import type {
  AIActionStatus, ApprovalStatus, AttendanceStatus, AutomationStatus, ClientStatus, EmploymentStatus,
  FileStatus, LeaveRequestStatus, NotificationStatus, ProjectStatus, ReviewStatus, TaskStatus,
  TimeEntryStatus, TimesheetStatus, UserAccountStatus, WorkflowExecutionStatus, WorkspaceStatus,
} from './statuses.js'

export interface Organization extends TenantEntity, ArchiveFields { name: string; slug: string; status: 'active' | 'suspended' | 'archived' }
export interface OrganizationSettings extends TenantEntity { timezone: string; locale: 'ar' | 'en'; weekStartsOn: 0 | 1 | 6; retentionPolicyId: string }
export interface Department extends TenantEntity, ArchiveFields { name: string; code: string; managerUserId?: string; status: 'active' | 'archived' }
export interface Team extends TenantEntity, ArchiveFields { name: string; code: string; departmentId: string; leaderUserId?: string; status: 'active' | 'archived' }

export interface UserIdentity extends GlobalEntity { email: string; accountStatus: UserAccountStatus; tokensValidAfter: UtcIsoString }
export interface UserProfile extends TenantEntity { userId: string; displayName: string; firstName: string; locale: 'ar' | 'en'; timezone: string; avatarFileId?: string }
export interface OrganizationMember extends TenantEntity { userId: string; status: 'invited' | 'active' | 'suspended' | 'left'; invitedAt: UtcIsoString; joinedAt?: UtcIsoString; leftAt?: UtcIsoString }
export interface Invitation extends TenantEntity { userId: string; emailHash: string; status: 'pending' | 'accepted' | 'expired' | 'cancelled' | 'failed'; expiresAt: UtcIsoString; acceptedAt?: UtcIsoString }
export interface EmploymentProfile extends TenantEntity, ArchiveFields { userId: string; employeeNumber: string; employmentType: 'employee' | 'contractor'; primaryDepartmentId: string; jobTitle: string; managerUserId?: string; workScheduleId?: string; status: EmploymentStatus; startDate: string; endDate?: string; endReason?: string }
export interface Role extends TenantEntity, ArchiveFields { name: string; permissions: readonly string[]; policyVersion: number; status: 'active' | 'archived' }
export interface PermissionDefinition extends TenantEntity { key: string; description: string; sensitivity: 'low' | 'medium' | 'high' | 'critical' }
export interface RoleAssignment extends TenantEntity { userId: string; roleId: string; scopeType: string; scopeId: string; effect: 'grant' | 'deny'; status: 'active' | 'revoked'; startsAt?: UtcIsoString; expiresAt?: UtcIsoString }
export interface TeamMembership extends TenantEntity { teamId: string; userId: string; membershipRole: 'leader' | 'member'; isPrimary: boolean; allocationPercent?: number; status: 'active' | 'ended' }

export interface Client extends TenantEntity, ArchiveFields { name: string; code: string; industry?: string; status: ClientStatus; accountManagerUserId?: string }
export interface ClientContact extends TenantEntity { clientId: string; name: string; emailHash: string; emailCiphertext: string; encryptionKeyVersion: string; portalStatus: 'none' | 'eligible' | 'invited' | 'active' | 'disabled'; clientAdmin: boolean; userId?: string }
export interface Project extends TenantEntity, ArchiveFields { clientId: string; name: string; code: string; status: ProjectStatus; departmentId?: string; managerUserId: string; startsOn?: string; dueOn?: string; clientVisible: boolean }
export interface ProjectMember extends TenantEntity { projectId: string; userId: string; contactId?: string; principalType: 'member' | 'client'; access: 'viewer' | 'contributor' | 'manager'; status: 'active' | 'ended' }
export interface ProjectFinancials extends TenantEntity { projectId: string; currency: string; budgetMinor: number; billingModel: 'fixed' | 'hourly' | 'retainer' | 'non_billable'; status: 'draft' | 'approved' | 'locked' }
export interface Workspace extends TenantEntity, ArchiveFields { projectId?: string; departmentId?: string; ownerTeamId?: string; name: string; status: WorkspaceStatus; visibility: 'private' | 'team' | 'project'; createdBy: string }
export interface WorkspaceMember extends TenantEntity { workspaceId: string; userId: string; membershipRole: 'manager' | 'supervisor' | 'member' | 'viewer'; source: 'explicit' | 'project'; status: 'active' | 'ended'; joinedAt: UtcIsoString; endedAt?: UtcIsoString }

export interface Task extends TenantEntity, ArchiveFields { projectId: string; workspaceId?: string; parentTaskId?: string; title: string; description: string; status: TaskStatus; priority: 'low' | 'medium' | 'high' | 'urgent'; createdBy: string; assigneeUserId?: string; workflowInstanceId?: string; dueAt?: UtcIsoString; completedAt?: UtcIsoString; clientVisible: boolean }
export interface Subtask extends TenantEntity { taskId: string; title: string; status: TaskStatus; assigneeUserId?: string; completedAt?: UtcIsoString }
export interface Checklist extends TenantEntity { taskId: string; title: string; required: boolean }
export interface ChecklistItem extends TenantEntity { checklistId: string; taskId: string; text: string; required: boolean; completed: boolean; completedBy?: string; completedAt?: UtcIsoString }
export interface TaskAssignment extends TenantEntity { taskId: string; userId?: string; teamId?: string; assignmentRole: 'responsible' | 'contributor'; status: 'pending' | 'accepted' | 'declined' | 'ended'; assignedBy: string; acceptedAt?: UtcIsoString; declinedAt?: UtcIsoString; endedAt?: UtcIsoString }
export interface TaskWatcher extends TenantEntity { taskId: string; userId: string }
export interface Tag extends TenantEntity, ArchiveFields { name: string; color: string }

export interface WorkflowTemplate extends TenantEntity, ArchiveFields { name: string; status: 'draft' | 'published' | 'archived'; latestVersionId?: string }
export interface WorkflowVersion extends TenantEntity { templateId: string; versionNumber: number; status: 'draft' | 'published' | 'archived'; definitionHash: string; publishedAt?: UtcIsoString; publishedBy?: string }
export interface WorkflowStage extends TenantEntity { workflowVersionId: string; key: string; name: string; type: 'work' | 'review' | 'approval' | 'automation'; order: number; terminal: boolean; slaMinutes?: number }
export interface WorkflowTransition extends TenantEntity { workflowVersionId: string; fromStageId: string; toStageId: string; key: string; requiredPermission: string; condition?: Readonly<{ field: string; operator: 'equals' | 'not_equals' | 'exists'; value?: string | number | boolean }> }
export interface TaskWorkflowInstance extends TenantEntity { taskId: string; workflowVersionId: string; currentStageId: string; currentStageKey: string; status: WorkflowExecutionStatus; concurrencyVersion: number; cycle: number; stageDueAt?: UtcIsoString }
export interface TaskStageExecution extends TenantEntity { workflowInstanceId: string; stageId: string; stageKey: string; cycle: number; status: WorkflowExecutionStatus; enteredAt: UtcIsoString; exitedAt?: UtcIsoString; actorUserId?: string; transitionId?: string; slaBreachedAt?: UtcIsoString }
export interface ReviewRequest extends TenantEntity { taskId: string; stageExecutionId?: string; requestedBy: string; reviewerUserIds: readonly string[]; approvalIds: readonly string[]; policy: 'single' | 'any' | 'all' | 'ordered'; round: number; reviewedVersion: number; visibility: 'internal' | 'client'; status: ReviewStatus; dueAt?: UtcIsoString }
export interface Approval extends TenantEntity { reviewRequestId: string; round: number; reviewerUserId: string; order: number; reviewedVersion: number; status: ApprovalStatus; decidedAt?: UtcIsoString; decisionReason?: string; delegatedFromApprovalId?: string }
export interface ChangeRequest extends TenantEntity { taskId: string; reviewRequestId: string; reviewRound: number; requestedBy: string; description: string; status: 'open' | 'resolved' | 'cancelled'; resolvedAt?: UtcIsoString }

export interface Comment extends TenantEntity { resourceType: 'task' | 'project'; resourceId: string; authorUserId: string; body: string; visibility: 'internal' | 'client'; status: 'active' | 'deleted'; parentCommentId?: string; linkedReviewRequestId?: string; editableUntil: UtcIsoString; editedAt?: UtcIsoString; lockedAt?: UtcIsoString; deletedAt?: UtcIsoString }
export interface Mention extends TenantEntity { commentId: string; mentionedUserId: string; visibility: 'internal' | 'client'; status: 'active' }
export interface Reaction extends TenantEntity { commentId: string; userId: string; type: 'like' | 'celebrate' | 'support' | 'insightful'; status: 'active' | 'removed' }
export interface Attachment extends TenantEntity { resourceType: 'task' | 'project'; resourceId: string; fileId: string; displayName: string; visibility: 'internal' | 'client'; status: FileStatus; retentionState: 'active' | 'deleted' | 'legal_hold' | 'purging' | 'purged'; latestVersionId?: string; latestVersionNumber: number; pendingVersionId?: string; deletedAt?: UtcIsoString; purgeAfter?: UtcIsoString }
export interface FileVersion extends TenantEntity { fileId: string; versionNumber: number; provider: string; objectKey: string; sizeBytes: number; contentType: string; checksumSha256: string; scanStatus: 'pending' | 'clean' | 'infected' | 'error'; status: FileStatus; uploadedBy: string; scanReportHash?: string }

export interface Notification extends TenantEntity { userId: string; type: string; title: string; status: NotificationStatus; resourceType?: string; resourceId?: string; readAt?: UtcIsoString }
export interface NotificationPreference extends TenantEntity { userId: string; channel: 'in_app' | 'email'; eventType: string; enabled: boolean }
export interface TimeEntry extends TenantEntity { userId: string; taskId?: string; projectId: string; startedAt: UtcIsoString; endedAt?: UtcIsoString; minutes: number; status: TimeEntryStatus }
export interface Timesheet extends TenantEntity { userId: string; periodStart: string; periodEnd: string; status: TimesheetStatus; submittedAt?: UtcIsoString; approvedAt?: UtcIsoString }
export interface WorkSchedule extends TenantEntity { userId: string; timezone: string; weeklyMinutes: number; effectiveFrom: string; effectiveTo?: string }
export interface AttendanceRecord extends TenantEntity { userId: string; date: string; status: AttendanceStatus; source: 'manual' | 'correction'; checkInAt?: UtcIsoString; checkOutAt?: UtcIsoString }
export interface LeaveType extends TenantEntity, ArchiveFields { name: string; paid: boolean; annualAllowanceDays?: number }
export interface LeaveRequest extends TenantEntity { userId: string; leaveTypeId: string; startsOn: string; endsOn: string; status: LeaveRequestStatus; approverUserId?: string; decidedAt?: UtcIsoString }
export interface Holiday extends TenantEntity { name: string; date: string; branchId?: string }
export interface CapacityPlan extends TenantEntity { userId: string; periodStart: string; periodEnd: string; availableMinutes: number; allocatedMinutes: number }
export interface Goal extends TenantEntity { ownerUserId?: string; teamId?: string; title: string; status: 'draft' | 'active' | 'completed' | 'cancelled'; dueOn?: string }
export interface KPIDefinition extends TenantEntity, ArchiveFields { key: string; name: string; unit: string; direction: 'higher_better' | 'lower_better' | 'neutral'; status: 'active' | 'archived' }
export interface KPIMeasurement extends TenantEntity { kpiDefinitionId: string; subjectType: 'organization' | 'department' | 'team' | 'user' | 'project'; subjectId: string; periodStart: string; periodEnd: string; value: number; delayAttribution?: 'assignee' | 'reviewer' | 'client' | 'dependency' | 'system' | 'unattributed' }

export interface Automation extends TenantEntity, ArchiveFields { name: string; status: AutomationStatus; triggerType: string; actionTypes: readonly string[]; servicePrincipalId: string; riskLevel: 'low' | 'medium' | 'high' }
export interface AutomationRun extends TenantEntity { automationId: string; triggerEventId: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; attemptCount: number; startedAt?: UtcIsoString; completedAt?: UtcIsoString }
export interface AIRequest extends TenantEntity { requestedBy: string; purpose: string; modelPolicyId: string; status: 'queued' | 'processing' | 'completed' | 'failed'; promptHash: string }
export interface AIActionProposal extends TenantEntity { aiRequestId: string; actionType: string; argumentsHash: string; riskLevel: 'low' | 'medium' | 'high'; status: AIActionStatus; approvedBy?: string; executedAt?: UtcIsoString }
export interface AuditEvent extends TenantEntity { sequence: number; eventType: string; actorUserId: string | null; correlationId: string; resourceType: string; resourceId: string; outcome: 'allowed' | 'denied' | 'succeeded' | 'failed'; occurredAt: UtcIsoString; beforeHash?: string; afterHash?: string }
export interface Integration extends TenantEntity, ArchiveFields { provider: string; status: 'disabled' | 'active' | 'error'; credentialReference?: string; configuration: Readonly<Record<string, string>> }
export interface Webhook extends TenantEntity, ArchiveFields { integrationId: string; eventTypes: readonly string[]; endpointReference: string; signingSecretReference: string; status: 'active' | 'paused' | 'archived' }
export interface SavedView extends TenantEntity { ownerUserId: string; resourceType: string; name: string; filters: Readonly<Record<string, unknown>>; visibility: 'private' | 'team' | 'organization' }
export interface CustomFieldDefinition extends TenantEntity, ArchiveFields { resourceType: string; key: string; name: string; fieldType: 'text' | 'number' | 'date' | 'select' | 'boolean'; required: boolean; options?: readonly string[] }
export interface CustomFieldValue extends TenantEntity { definitionId: string; resourceType: string; resourceId: string; value: unknown }
export interface WorkTemplate extends TenantEntity, ArchiveFields { name: string; templateType: 'task' | 'project'; status: 'draft' | 'published' | 'archived'; payload: Readonly<Record<string, unknown>>; workflowVersionId?: string; publishedAt?: UtcIsoString; publishedBy?: string }
export interface RecurrenceSchedule extends TenantEntity, ArchiveFields { templateId: string; status: 'active' | 'paused' | 'archived'; timezone: string; frequency: 'daily' | 'weekly' | 'monthly'; interval: number; timeLocal: string; daysOfWeek?: readonly number[]; dayOfMonth?: number; nextRunAt: UtcIsoString; runAsUserId: string; scopeType: 'organization' | 'department' | 'team' | 'project'; scopeId: string }
export interface RecurrenceRun extends TenantEntity { scheduleId: string; templateId: string; occurrenceAt: UtcIsoString; status: 'started' | 'completed' | 'failed'; generatedResourceType?: string; generatedResourceId?: string; errorCode?: string }

export const ENTITY_DESCRIPTORS = [
  'organization', 'organization_settings', 'department', 'team', 'user_profile', 'organization_membership', 'invitation', 'employment_profile',
  'role', 'permission_definition', 'role_assignment', 'team_membership', 'client', 'client_contact', 'project',
  'project_member', 'project_financials', 'workspace', 'workspace_member', 'task', 'subtask', 'checklist', 'checklist_item', 'task_assignment', 'task_watcher',
  'tag', 'workflow_template', 'workflow_version', 'workflow_stage', 'workflow_transition', 'task_workflow_instance',
  'task_stage_execution', 'review_request', 'approval', 'change_request', 'comment', 'mention', 'reaction', 'attachment',
  'file_version', 'notification', 'notification_preference', 'time_entry', 'timesheet', 'work_schedule', 'attendance_record',
  'leave_type', 'leave_request', 'holiday', 'capacity_plan', 'goal', 'kpi_definition', 'kpi_measurement', 'automation',
  'automation_run', 'ai_request', 'ai_action_proposal', 'audit_event', 'integration', 'webhook', 'saved_view',
  'custom_field_definition', 'custom_field_value',
  'work_template', 'recurrence_schedule', 'recurrence_run',
] as const

export type TenantEntityKind = typeof ENTITY_DESCRIPTORS[number]
