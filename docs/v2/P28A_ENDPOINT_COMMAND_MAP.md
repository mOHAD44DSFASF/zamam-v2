# P28A — Endpoint → Command Map (BLK-001 closure)

Generated as part of closing BLK-001 (`DisabledFeatureCommandDispatcher` replaced by
`composeFeatureCommandDispatcher` in `services/functions/src/api/compose.ts`). Every row below is a
literal entry in `FEATURE_API_PATHS` (`services/functions/src/api/feature-routes.ts`). The dispatcher
(`services/functions/src/api/dispatcher.ts`) resolves the caller's `AuthorizationPrincipal` via
`FirestoreIdentityResolver`, builds a `CommandContext` (organizationId, principal, correlationId,
idempotencyKey, fingerprint), and routes to the registered handler in
`services/functions/src/api/handlers/*.ts`. Unknown/missing handlers fail closed with
`UNKNOWN_COMMAND_NOT_CONFIGURED` (mapped to HTTP 503) — see `dispatcher.ts`.

Permission enforcement, organization/resource scoping, version-conflict checks, and audit-event
generation happen **inside the existing Prompt 2–27 domain services** (`AuditCommandService`,
`TrustedAuthorizationService`) — the dispatcher and handler files only route and adapt wire shapes;
they do not reimplement business rules.

Legend: **Idempotency** — "AuditCommandService" means the command is wrapped in
`AuditCommandService.execute()`, which persists a per-organization idempotency record keyed by
`(organizationId, idempotencyKey)` plus a request fingerprint, in addition to the outer HTTP-layer
idempotency store in `api.ts`. "N/A (read)" means the endpoint is a query with no side effects.

| Endpoint | Command | Handler | Required permission | Organization scope | Validation schema | Idempotency | Audit event | Feature flag | Test coverage |
|---|---|---|---|---|---|---|---|---|---|
| `/v1/organization/directory/query` | read | `handlers/organization.ts` | `organization.view` | `input.organizationId` | route-level `organizationCommand` | N/A (read) | — | — | `dispatcher-composition.test.ts`; `organization-structure.test.ts` |
| `/v1/organization/departments/create` | `OrganizationStructureService.createDepartment` | `handlers/organization.ts` | `department.create` | `input.organizationId` | inline `idSchema`/name/code in `organization/service.ts` | AuditCommandService | `department.created` | — | `organization-structure.test.ts` |
| `/v1/organization/teams/create` | `OrganizationStructureService.createTeam` | `handlers/organization.ts` | `team.create` | `input.organizationId` | inline schema | AuditCommandService | `team.created` | — | `organization-structure.test.ts` |
| `/v1/employees/query` | read | `handlers/employee.ts` | `user.view` | `input.organizationId` | route-level | N/A (read) | — | — | `dispatcher-composition.test.ts`; `employee-management.test.ts` |
| `/v1/employees/invite` | `EmployeeService.invite` | `handlers/employee.ts` | `user.invite` | `input.organizationId` | `inviteSchema` (`employee/service.ts`) | AuditCommandService | `user.invited` | — | `employee-management.test.ts` |
| `/v1/employees/disable` | `EmployeeService.disable` | `handlers/employee.ts` | `user.disable` | `input.organizationId` | inline id/version/reason | AuditCommandService | `user.disabled` | — | `employee-management.test.ts` |
| `/v1/clients/query` | read | `handlers/client.ts` | `client.view` | `input.organizationId` | route-level | N/A (read) | — | — | `client-management.test.ts` |
| `/v1/clients/create` | `ClientService.create` | `handlers/client.ts` | `client.create` | `input.organizationId` | `clientSchema` (`client/service.ts`) | AuditCommandService | `client.created` | — | `client-management.test.ts` |
| `/v1/clients/contacts/create` | `ClientService.addContact` | `handlers/client.ts` | `client.contact.manage` | `input.organizationId` | `contactSchema` | AuditCommandService | `client.contact_created` | PII encryption key must be configured (`CLIENT_PII_*` env; `SECRET_NOT_CONFIGURED` otherwise) | `client-management.test.ts` |
| `/v1/clients/contacts/eligibility` | `ClientService.setPortalEligibility` | `handlers/client.ts` | `client.contact.manage` | `input.organizationId` | inline id/version/boolean | AuditCommandService | `client.contact_eligibility_changed` | — | `client-management.test.ts` |
| `/v1/projects/query` | read | `handlers/project.ts` | `project.view` | `input.organizationId` | route-level | N/A (read) | — | — | `project-management.test.ts` |
| `/v1/projects/create` | `ProjectService.create` | `handlers/project.ts` | `project.create` | `input.organizationId` | `projectSchema` | AuditCommandService | `project.created` | — | `project-management.test.ts` |
| `/v1/projects/client-visibility` | `ProjectService.setClientVisibility` | `handlers/project.ts` | `project.manage` | `input.organizationId` | inline id/version/boolean | AuditCommandService | `project.client_visibility_changed` | — | `project-management.test.ts` |
| `/v1/workspaces/query` | read | `handlers/workspace.ts` | `workspace.view` | `input.organizationId` | route-level | N/A (read) | — | — | `workspace-redesign.test.ts` |
| `/v1/workspaces/create` | `WorkspaceService.create` | `handlers/workspace.ts` | `workspace.create` | `input.organizationId` | `createSchema` | AuditCommandService | `workspace.created` | — | `workspace-redesign.test.ts` |
| `/v1/tasks/query` | `TaskQueryService.list` | `handlers/task.ts` | `task.view` / `task.view_all` (scope-dependent) | `input.organizationId` | `TaskQueryService` internal filters | N/A (read) | — | — | `task-views.test.ts` |
| `/v1/tasks/create` | `TaskService.create` | `handlers/task.ts` | `task.create` | `input.organizationId` | `createTaskSchema` | AuditCommandService | `task.created` | — | `task-management.test.ts` |
| `/v1/tasks/update` | `TaskService.update` | `handlers/task.ts` | `task.update` | `input.organizationId` | `updateTaskSchema` | AuditCommandService | `task.updated` | — | `task-management.test.ts` |
| `/v1/task-views/create` | `SavedTaskViewService.create` | `handlers/task.ts` | `saved_view.create` / `saved_view.share` | `input.organizationId` | `savedViewSchema` (`task/query.ts`) | AuditCommandService | `command.<permission>` | — | `task-views.test.ts` |
| `/v1/workflows/builder/query` | read | `handlers/workflow.ts` | `workflow.view` | `input.organizationId` | route-level | N/A (read) | — | — | `workflow-builder.test.ts` |
| `/v1/workflows/drafts/update` | `WorkflowBuilderService.updateDraft` | `handlers/workflow.ts` | `workflow.manage` | `input.organizationId` | `definitionSchema` | AuditCommandService | `workflow.draft_updated` | — | `workflow-builder.test.ts` |
| `/v1/workflows/simulate` | `WorkflowBuilderService.simulate` | `handlers/workflow.ts` | none (pure function, no persistence) | n/a | `definitionSchema` | N/A (pure) | — | — | `workflow-builder.test.ts` |
| `/v1/workflows/publish` | `WorkflowBuilderService.publish` | `handlers/workflow.ts` | `workflow.publish` (step-up) | `input.organizationId` | inline ids/versions | AuditCommandService | `workflow.published` | — | `workflow-builder.test.ts` |
| `/v1/workflows/instances/transition` | `WorkflowExecutionService.transition` | `handlers/workflow.ts` | dynamic (from the workflow transition's `requiredPermission`) | `input.organizationId` | inline ids/version | AuditCommandService + `AuditCommandService.replay` | `task.transitioned` | Gate port requires an approved `review_request` before leaving a `review`/`approval`-typed stage (v1 simplification — see code comment) | `workflow-execution.test.ts` |
| `/v1/reviews/inbox` | read | `handlers/review.ts` | `review.perform` | `input.organizationId` | route-level | N/A (read) | — | — | `review-approval.test.ts` |
| `/v1/reviews/decide` | `ReviewService.decide` | `handlers/review.ts` | `review.perform` / `task.approve` (visibility-dependent) | `input.organizationId` | inline approvalId/version/decision | AuditCommandService | `review.completed` | — | `review-approval.test.ts` |
| `/v1/templates/query` | read | `handlers/template.ts` | `template.view` | `input.organizationId` | route-level | N/A (read) | — | — | `templates-recurrence.test.ts` |
| `/v1/templates/create` | `TemplateService.create` | `handlers/template.ts` | `template.create` | `input.organizationId` | inline id/name/type/payload | AuditCommandService | `template.created` | — | `templates-recurrence.test.ts` |
| `/v1/templates/publish` | `TemplateService.publish` | `handlers/template.ts` | `template.publish` (step-up) | `input.organizationId` | inline id/version | AuditCommandService | `template.published` | — | `templates-recurrence.test.ts` |
| `/v1/recurrences/status` | read | `handlers/template.ts` | `recurrence.manage` | `input.organizationId` | route-level | N/A (read) | — | — | `templates-recurrence.test.ts` |
| `/v1/collaboration/query` | read | `handlers/collaboration.ts` | `comment.internal.view` / `comment.client.view` | `input.organizationId` | route-level | N/A (read) | — | — | `collaboration-service.test.ts` |
| `/v1/comments/create` | `CollaborationService.create` | `handlers/collaboration.ts` | `comment.<visibility>.create` (+ `mention.create` if mentions present) | `input.organizationId` | `createSchema` | AuditCommandService | `comment.created` | — | `collaboration-service.test.ts` |
| `/v1/comments/delete` | `CollaborationService.tombstone` | `handlers/collaboration.ts` | `comment.<visibility>.delete` | `input.organizationId` | inline id/version | AuditCommandService | `comment.deleted` | — | `collaboration-service.test.ts` |
| `/v1/reactions/set` | `CollaborationService.setReaction` | `handlers/collaboration.ts` | `reaction.create` / `reaction.delete` | `input.organizationId` | inline id/type/active | AuditCommandService | `reaction.added` / `reaction.removed` | — | `collaboration-service.test.ts` |
| `/v1/tasks/watch` | `CollaborationService.setTaskWatch` | `handlers/collaboration.ts` | `task.watch` | `input.organizationId` | inline taskId/active | AuditCommandService | `task.watcher.added` / `task.watcher.removed` | — | `collaboration-service.test.ts` |
| `/v1/files/query` | read | `handlers/file.ts` | `file.view` / `file.internal.view` | `input.organizationId` | route-level | N/A (read) | — | — | `file-management.test.ts` |
| `/v1/files/upload/prepare` | `FileService.prepareUpload` | `handlers/file.ts` | `file.upload` / `file.version` (existing-version dependent) | `input.organizationId` | `prepareSchema` | AuditCommandService + replay | `file.upload_prepared` | Local storage always configured (`LocalPrivateStorage`); switches to R2 automatically when `R2_*` env vars present | `file-management.test.ts` |
| `/v1/files/upload/finalize` | `FileService.finalizeUpload` | `handlers/file.ts` | `file.upload` | `input.organizationId` | inline fileVersionId/version | AuditCommandService + replay | `file.scan_requested` | same as above | `file-management.test.ts` |
| `/v1/files/delete` | `FileService.delete` | `handlers/file.ts` | `file.delete` | `input.organizationId` | inline fileId/version | AuditCommandService | `file.deleted` | same as above | `file-management.test.ts` |
| `/v1/files/download` | `FileService.download` | `handlers/file.ts` | `file.download` | `input.organizationId` | inline fileId | AuditCommandService | `file.downloaded` | same as above | `file-management.test.ts` |
| `/v1/notifications/query` | read | `handlers/notification.ts` | `notification.view` | `input.organizationId` | route-level | N/A (read) | — | — | `notification-service.test.ts` |
| `/v1/notifications/status` | `NotificationCommandService.setStatus` | `handlers/notification.ts` | `notification.view` | `input.organizationId` | inline id/version/status | AuditCommandService | `notification.read` / `notification.archived` | — | `notification-service.test.ts` |
| `/v1/notifications/preferences/update` | `NotificationCommandService.updatePreference` | `handlers/notification.ts` | `notification.manage_preferences` | `input.organizationId` | `preferenceSchema` | AuditCommandService | `notification.preference_updated` | — | `notification-service.test.ts` |
| `/v1/workload/query` | read | `handlers/workload.ts` | `workload.view_self` / `_team` / `_organization` | `input.organizationId` | route-level | N/A (read) | — | — | `workload-capacity.test.ts` |
| `/v1/workload/rebuild` | `WorkloadProjectionService.rebuild` | `handlers/workload.ts` | `workload.manage` | `input.organizationId` | `rebuildSchema` | AuditCommandService | `workload.projection_rebuilt` | Scheduled/absence minutes derived from `work_schedule` + flat 8h/day leave conversion (v1 simplification — see code comment) | `workload-capacity.test.ts` |
| `/v1/time/query` | read | `handlers/time.ts` | `time.view_self` / `time.view_team` | `input.organizationId` | route-level | N/A (read) | — | — | `time-tracking.test.ts` |
| `/v1/time/timer/start` | `TimeTrackingService.startTimer` | `handlers/time.ts` | `time.track` | `input.organizationId` | `timerSchema` | AuditCommandService + replay | `time.timer_started` | — | `time-tracking.test.ts` |
| `/v1/time/timer/stop` | `TimeTrackingService.stopTimer` | `handlers/time.ts` | `time.track` | `input.organizationId` | inline entryId/version | AuditCommandService | `time.timer_stopped` | — | `time-tracking.test.ts` |
| `/v1/time/entries/create` | `TimeTrackingService.createManual` | `handlers/time.ts` | `time.track` | `input.organizationId` | `manualSchema` | AuditCommandService | `time.entry_created` | — | `time-tracking.test.ts` |
| `/v1/timesheets/submit` | `TimeTrackingService.submitTimesheet` | `handlers/time.ts` | `timesheet.submit` | `input.organizationId` | inline periodStart/periodEnd | AuditCommandService | `timesheet.submitted` | — | `time-tracking.test.ts` |
| `/v1/timesheets/decide` | `TimeTrackingService.decideTimesheet` | `handlers/time.ts` | `timesheet.approve` | `input.organizationId` | `decisionSchema` | AuditCommandService | `timesheet.approved` / `timesheet.rejected` | — | `time-tracking.test.ts` |
| `/v1/attendance/overview` | read | `handlers/attendance-leave.ts` | `attendance.view_self` / `attendance.view_team` | `input.organizationId` | route-level | N/A (read) | — | — | `attendance-leave.test.ts` |
| `/v1/attendance/record` | `AttendanceService.record` | `handlers/attendance-leave.ts` | `attendance.record` | `input.organizationId` | `recordSchema` | AuditCommandService | `attendance.recorded` | — | `attendance-leave.test.ts` |
| `/v1/leave/request` | `LeaveService.request` | `handlers/attendance-leave.ts` | `leave.request` | `input.organizationId` | `requestSchema` | AuditCommandService | `leave.requested` | Approval chain is the requester's direct manager only (v1 simplification — see code comment); requests fail closed with `LEAVE_APPROVAL_CHAIN_INVALID` if no manager is configured | `attendance-leave.test.ts` |
| `/v1/leave/decide` | `LeaveService.decide` | `handlers/attendance-leave.ts` | `leave.approve` | `input.organizationId` | inline requestId/version/decision | AuditCommandService | `leave.approved` / `leave.rejected` / `leave.approval_advanced` | — | `attendance-leave.test.ts` |
| `/v1/reports/query` | read | `handlers/reporting.ts` | `report.view_organization` | `input.organizationId` | route-level | N/A (read) | — | — | `reporting.test.ts` |
| `/v1/reports/export` | `ReportingService.requestExport` | `handlers/reporting.ts` | `report.export` (step-up) | `input.organizationId` | `exportSchema` | AuditCommandService | `report.export_requested` | Field allowlist is a static per-report-type table until a per-organization field catalog exists (v1 simplification — see code comment); actual CSV generation is a worker job (BLK-002) | `reporting.test.ts` |
| `/v1/automations/query` | read | `handlers/automation.ts` | `automation.view` | `input.organizationId` | route-level | N/A (read) | — | — | `automation-engine.test.ts` |
| `/v1/automations/status` | read | `handlers/automation.ts` | `automation.view` | `input.organizationId` | route-level | N/A (read) | — | — | `automation-engine.test.ts` |
| `/v1/ai/query` | read | `handlers/ai.ts` | `ai.view_history` | `input.organizationId` | route-level | N/A (read) | — | — | `ai-safety.test.ts` |
| `/v1/ai/request` | `AIService.request` | `handlers/ai.ts` | `ai.use` | `input.organizationId` | `requestSchema` | AuditCommandService | `ai.requested` | **`AI_ENABLED`** — gated on `OPENAI_API_KEY` being configured; when absent the org policy reports `enabled:false` and the service throws the typed `AI_DISABLED` error (HTTP 503, code `FEATURE_DISABLED`), never a bare uncomposed 503 | `ai-safety.test.ts`; `dispatcher-composition.test.ts` (disabled-feature typed response) |
| `/v1/ai/proposals/decide` | `AIService.decideProposal` | `handlers/ai.ts` | `ai.action.approve` (step-up) | `input.organizationId` | inline proposalId/version/decision/hash | AuditCommandService | `ai.proposal_approved` / `ai.proposal_rejected` | — | `ai-safety.test.ts` |
| `/v1/portal/dashboard` | `PortalService.dashboard` | `handlers/portal.ts` | `portal.view` | `input.organizationId` | route-level | N/A (read) | — | — | `client-portal.test.ts` |
| `/v1/portal/projects/get` | `PortalService.project` | `handlers/portal.ts` | `portal.view` | `input.organizationId` | inline projectId | N/A (read) | — | — | `client-portal.test.ts` |
| `/v1/portal/requests/create` | `PortalService.createRequest` | `handlers/portal.ts` | `portal.request.create` | `input.organizationId` | `requestSchema` | AuditCommandService | `client.request_created` | — | `client-portal.test.ts` |
| `/v1/portal/approvals/decide` | `ReviewService.decide` (reused, portal-scoped) | `handlers/portal.ts` | `task.approve` | `input.organizationId` | inline approvalId/version/decision | AuditCommandService | `review.completed` | — | `client-portal.test.ts` |
| `/v1/portal/files/download` | `FileService.download` (reused, portal-scoped) | `handlers/portal.ts` | `file.download` | `input.organizationId` | inline fileId | AuditCommandService | `file.downloaded` | Local storage always configured | `client-portal.test.ts` |
| `/v1/auth/password-reset` | queue password-reset request | `handlers/auth.ts` | none (public route, App Check only) | n/a | `{email}` (route-level, public schema) | N/A (queues a `_passwordResetRequests` record; no idempotency key required by this public route) | — (not a tenant command; no audit trail by design — no authenticated actor) | Real email delivery is NOT_CONFIGURED (worker/email adapter is BLK-002 territory); this handler only queues the hashed request | none yet — flagged below |
| `/v1/auth/invitations/accept` | `EmployeeService.acceptInvitation` | `handlers/auth.ts` | none (public route; authenticated by token possession, verified via constant-time SHA-256 hash comparison — same convention as `Invitation.emailHash`) | resolved dynamically from the token (`InvitationLookupPort.findByTokenHash`, a collectionGroup lookup) | `acceptInvitationSchema` (`employee/service.ts`) + route-level public schema | AuditCommandService (context built after the token resolves an organization/actor) | `user.activated` | — | `employee-management.test.ts` (`invitation acceptance` — valid accept, expired, already-used, invalid/unknown token, tampered hash, wrong-user isolation) |

## Fixed since the previous revision of this document

- **`FirebaseAtomicStore.get()` and `FirestorePageQueryStore.list()` now decode Firestore `Timestamp`
  values to ISO strings** (`packages/firestore/src/schema.ts`'s `decodeValue`, now exported and reused by
  both). Previously a raw transaction/query read returned live `Timestamp` instances for any
  `SERVER_TIMESTAMP`-written field, so `Date.parse(String(...))` on those fields (SLA due-dates in
  `WorkflowExecutionService`, retention/purge dates in `FileService`, comment edit windows in
  `CollaborationService`) produced `NaN` against a real Firestore backend — invisible to every existing
  unit test because their in-memory `AtomicStore` fakes never produced a real `Timestamp`. Regression
  coverage: `tests/firestore-timestamp-decoding.test.ts`.
- **`/v1/auth/invitations/accept` is implemented** — see the endpoint table row above.

## Known gaps carried forward (not silently papered over)

1. Several v1 simplifications are called out inline above and in code comments where a Port
   implementation had to make a judgment call in the absence of an existing domain rule (workflow
   business-calendar minutes, workload absence-minute conversion, leave approval chain, review workflow
   gate, KPI export field allowlist). None of these change any *existing*, tested business rule — they are
   new infrastructure-level defaults for ports that had no prior implementation to reuse.
