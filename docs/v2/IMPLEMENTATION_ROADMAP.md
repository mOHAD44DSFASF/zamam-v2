# خارطة تنفيذ ZAMAM V2: 28 Prompt

> **Proposed V2.** العدد ثابت: 28. كل Prompt ينتج PR/changeset مستقل ويمكن إيقافه. لا يبدأ Prompt قبل قبول dependencies والـowner decisions المشار إليها.

## قواعد عامة

- كل milestone: docs محدثة، threat/data review، tests، migration/rollback note.
- لا privileged business write في React.
- لا production data/deploy تلقائي ضمن prompts.
- paths المذكورة مثل `apps/web`, `services/functions`, `packages/*` مقترحة وتبدأ بعد Prompt 2.
- complexity: Small / Medium / Large / Extra Large.

## Prompt 1: Product and Architecture Blueprint

- **Objective:** تثبيت المنتج والدومين والصلاحيات/workflow/data/backend/UI/migration/roadmap.
- **Dependencies:** audit الحالي فقط.
- **Modules:** كل المنصة conceptual.
- **Docs:** ملفات `docs/v2/*` الأحد عشر.
- **Code areas:** لا source code.
- **Data/backend/security:** لا writes؛ tenant/RBAC/backend design فقط.
- **Tests:** document consistency/secret/file checks.
- **Acceptance:** validation report = usable أو ready؛ 28 prompts؛ owner IDs.
- **Rollback:** حذف docs changeset فقط.
- **Complexity/Risks:** Large؛ contradiction أو rule invented.
- **Exclusions:** implementation، dependency/config/deploy.

## Prompt 2: Repository Restructuring Foundation

- **Objective:** monorepo boundaries أو equivalent دون تغيير behavior.
- **Dependencies:** Prompt 1، قرارات stack.
- **Modules:** web/shared contracts/domain/infrastructure.
- **Docs:** architecture decision records، developer setup.
- **Code areas:** proposed `apps/web`, `packages/*`, `services/*`.
- **Database/backend/security:** لا schema migration؛ secrets/environment boundaries scaffold.
- **Tests:** existing build parity، lint baseline، smoke routes.
- **Acceptance:** same V1 behavior/build؛ imports boundaries enforced.
- **Rollback:** keep compatibility entry أو revert move commit.
- **Complexity/Risks:** Large؛ path/build break.
- **Exclusions:** auth/business redesign.

## Prompt 3: Authentication Foundation

- **Objective:** session provider، route guards، login/reset/invite، disabled-session handling.
- **Dependencies:** P2؛ OD-SEC-01، OD-ORG-02.
- **Modules:** Auth adapter/UI.
- **Docs:** auth lifecycle/threat model.
- **Code areas:** web auth shell/hooks، emulator fixtures.
- **Database:** global user/member read model minimal؛ no role trust.
- **Backend:** invite/reset/disable adapters scaffold.
- **Security:** token verify/revoke، no account enumeration، MFA-ready.
- **Tests:** unit + emulator + E2E personas/logout/reset.
- **Acceptance:** unauthorized route never renders data؛ disabled token denied.
- **Rollback:** feature flag to legacy login في non-production فقط.
- **Complexity/Risks:** Large؛ lockout/session race.
- **Exclusions:** full permissions/user admin.

## Prompt 4: Trusted Backend Foundation

- **Objective:** Functions command API، Cloud Run worker skeleton، contracts/observability/idempotency/outbox.
- **Dependencies:** P2-P3.
- **Modules:** API core، auth context، jobs/events/audit stub.
- **Docs:** API conventions/runbooks.
- **Code areas:** `services/functions`, `services/workers`, `packages/contracts`.
- **Database:** idempotency/outbox staging schema only.
- **Backend:** request envelope/errors/correlation.
- **Security:** App Check/CORS/rate-limit/secrets interfaces.
- **Tests:** contract، auth middleware، idempotency، local integration.
- **Acceptance:** sample non-business command traced end-to-end، no secrets.
- **Rollback:** disable endpoint/worker؛ no business cutover.
- **Complexity/Risks:** Extra Large؛ operational complexity.
- **Exclusions:** domain CRUD.

## Prompt 5: Permission and Authorization System

- **Objective:** RBAC + scoped policy engine + deny-by-default rules.
- **Dependencies:** P3-P4؛ OD-ROL-*.
- **Modules:** roles، assignments، authorization.
- **Docs:** permission catalog/matrix updated.
- **Code areas:** `packages/authorization`, backend middleware، rules tests.
- **Database:** roles/assignments/member permission version.
- **Backend:** evaluate/explain-safe/assign commands.
- **Security:** tenant isolation، deny precedence، anti-escalation، step-up.
- **Tests:** exhaustive role/scope/cross-tenant/disabled matrices.
- **Acceptance:** unknown/cross-org denied؛ privileged writes backend-only.
- **Rollback:** policy version rollback؛ retain audit.
- **Complexity/Risks:** Extra Large؛ accidental grant/lockout.
- **Exclusions:** feature-specific screens beyond simulator/admin minimum.

## Prompt 6: V2 Schema, Converters and Audit Foundation

- **Objective:** typed entities، canonical timestamps، converters، audit append/outbox، rules.
- **Dependencies:** P4-P5؛ domain owner decisions P0.
- **Modules:** Firestore layer، audit، migrations skeleton.
- **Docs:** schema/index/retention ADRs.
- **Code areas:** `packages/domain`, `packages/firestore`, audit service.
- **Database:** V2 staging namespace/schemaVersion، no production migration.
- **Backend:** repositories/transactions.
- **Security:** field projections، immutable audit.
- **Tests:** converter/schema/rules/property/transaction tests.
- **Acceptance:** every tenant entity org-bound؛ audit coverage fixture 100%.
- **Rollback:** drop isolated staging V2 data؛ source untouched.
- **Complexity/Risks:** Extra Large؛ schema mismatch/cost.
- **Exclusions:** V1 data cutover.

### Quality Gate after Prompt 6

- **Security:** auth, tenant, deny-default, rules mutation tests green.
- **Data:** schema/invariants/timestamp/reference fixtures green؛ backup/restore dry rehearsal.
- **Tests:** unit/integration/E2E foundation thresholds met؛ no skipped critical test.
- **Performance:** bounded repository query plans وcost baseline.
- **Docs:** ADR/API/schema/permission catalogs synchronized.
- **Decision:** any cross-tenant path أو unaudited sensitive command = **STOP**.

## Prompt 7: Organization, Departments and Teams

- **Objective:** organization settings، department/team lifecycle/membership.
- **Dependencies:** Gate 6؛ OD-ORG/DEP/TEAM.
- **Modules:** Organization/Department/Team.
- **Docs:** lifecycle and admin UX.
- **Code areas:** backend services، admin/team UI.
- **Database:** org/settings/departments/teams/teamMemberships.
- **Security:** scoped manage/view.
- **Tests:** hierarchy، membership، archive references، RTL E2E.
- **Acceptance:** org tree and scoped visibility correct.
- **Rollback:** feature flag/read-only؛ preserve created records.
- **Complexity/Risks:** Large؛ hierarchy/scope ambiguity.
- **Exclusions:** employee HR details.

## Prompt 8: Employee Management

- **Objective:** invite/profile/employment/disable/departure/schedules.
- **Dependencies:** P7؛ OD-EMP/SEC.
- **Modules:** User/Employment/Auth.
- **Docs:** HR privacy/lifecycle.
- **Code areas:** people directory/profile، backend Admin SDK.
- **Database:** members/employment/work schedules.
- **Security:** PII projections، revoke tokens، last Owner guard.
- **Tests:** invite partial failure، disable active session، field-level access.
- **Acceptance:** no client role writes؛ departure cleans access.
- **Rollback:** compensate invites/assignments؛ no hard delete.
- **Complexity/Risks:** Extra Large؛ identity/profile inconsistency.
- **Exclusions:** attendance/time/payroll.

## Prompt 9: Client Management

- **Objective:** clients/contacts/portal eligibility دون portal UI النهائي.
- **Dependencies:** P7-P8؛ OD-CLI-*.
- **Modules:** Client/Contact.
- **Docs:** client data/visibility.
- **Code areas:** client service/list/detail.
- **Database:** clients/clientContacts.
- **Security:** PII encryption/projections؛ no portal grant by contact existence.
- **Tests:** org/client isolation، archive/revoke.
- **Acceptance:** scoped CRUD and contact lifecycle audited.
- **Rollback:** archive feature flag؛ preserve records.
- **Complexity/Risks:** Large؛ duplicate contacts/privacy.
- **Exclusions:** portal login/screens.

## Prompt 10: Project Management

- **Objective:** project lifecycle/members/financial field separation.
- **Dependencies:** P9؛ OD-PRJ/FIN.
- **Modules:** Project/ProjectMember.
- **Docs:** lifecycle/visibility.
- **Code areas:** project service/screens.
- **Database:** projects/projectMembers.
- **Security:** member and financial projections.
- **Tests:** state transitions، membership، client/internal views.
- **Acceptance:** project queries bounded/scoped؛ archive guards.
- **Rollback:** feature flag and archive، no delete.
- **Complexity/Risks:** Large؛ permission intersection.
- **Exclusions:** tasks/workflows.

## Prompt 11: Workspace and Membership Redesign

- **Objective:** V2 workspaces، membership، V1 mapping dry run.
- **Dependencies:** P7-P10؛ OD-WSP.
- **Modules:** Workspace/Migration.
- **Docs:** V1 mapping and rehearsal report.
- **Code areas:** service/UI/migration inventory.
- **Database:** workspaces/workspaceMembers in staging.
- **Security:** no array-based client authorization.
- **Tests:** supervisors/members conflicts، orphan refs، cross-scope.
- **Acceptance:** inventory 100% accounted؛ staging migration reversible.
- **Rollback:** discard staging target؛ V1 unchanged.
- **Complexity/Risks:** Extra Large؛ ambiguous V1 semantics.
- **Exclusions:** production cutover/tasks.

### Quality Gate after Prompt 11

- Security: org/department/team/project/workspace scope matrix green.
- Data: user/role/workspace dry-run counts/references and idempotent rerun.
- Tests: identity through workspace E2E and rules.
- Performance: membership lookups/indexes bounded.
- Docs: mapping decisions signed.
- Decision: unknown privileged legacy mapping أو orphan غير مصنف = **STOP**.

## Prompt 12: Task Management Core

- **Objective:** typed tasks/subtasks/checklists/assignments CRUD.
- **Dependencies:** Gate 11؛ OD-TSK-*.
- **Modules:** Task.
- **Docs:** task lifecycle/validation.
- **Code areas:** Task service/details/create edit.
- **Database:** tasks/assignments/checklists/tags/custom values.
- **Security:** ownership لا يساوي permission؛ state guards.
- **Tests:** concurrency، claim، complete/reopen/archive.
- **Acceptance:** no direct Firestore writes؛ all commands AE.
- **Rollback:** V2 tasks feature flag؛ no V1 cutover.
- **Complexity/Risks:** Extra Large؛ state/data volume.
- **Exclusions:** custom workflows execution.

## Prompt 13: Task Views and Saved Filters

- **Objective:** list/board/calendar/timeline، pagination، saved views.
- **Dependencies:** P12.
- **Modules:** Query/Search/SavedView.
- **Docs:** query/index/performance budgets.
- **Code areas:** read APIs/views.
- **Database:** indexes/projections/savedViews.
- **Security:** filters cannot broaden scope.
- **Tests:** cursor/filter URL/accessibility/load.
- **Acceptance:** no full collection client filter؛ mobile alternatives.
- **Rollback:** disable advanced views؛ task detail remains.
- **Complexity/Risks:** Large؛ index explosion.
- **Exclusions:** full-text provider unless approved.

## Prompt 14: Workflow Builder

- **Objective:** draft graph editor، validation، simulation، publish.
- **Dependencies:** P12؛ OD-WFL-*.
- **Modules:** Workflow definitions.
- **Docs:** builder validation/versioning.
- **Code areas:** Workflow service/builder.
- **Database:** templates/versions/stages/transitions.
- **Security:** publish separate permission/step-up.
- **Tests:** graph property tests، immutable publish، a11y.
- **Acceptance:** invalid/unreachable graph cannot publish.
- **Rollback:** archive version؛ tasks not yet executing.
- **Complexity/Risks:** Extra Large؛ UX/graph semantics.
- **Exclusions:** active execution.

## Prompt 15: Workflow Execution Engine

- **Objective:** pinned instances، transitions، SLA، escalation، migration.
- **Dependencies:** P14.
- **Modules:** Workflow/Task/Event/Jobs.
- **Docs:** command/state/runbook.
- **Code areas:** engine/queues/task workflow UI.
- **Database:** instances/executions/events.
- **Security:** actor/permission/gates/version/idempotency.
- **Tests:** transition matrix، races، retries، time calendars.
- **Acceptance:** exactly-once effective transition؛ full history.
- **Rollback:** pause engine؛ queued commands retained؛ per-instance recovery.
- **Complexity/Risks:** Extra Large؛ concurrency.
- **Exclusions:** review semantics beyond generic stages.

## Prompt 16: Reviews and Approvals

- **Objective:** review cycles، approval policies، change/resubmit/delegate.
- **Dependencies:** P15؛ OD-APR-*.
- **Modules:** Review/Approval.
- **Docs:** evidence/conflict policy.
- **Code areas:** services/inboxes/details.
- **Database:** reviewRequests/approvals/changeRequests.
- **Security:** reviewed version/segregation/client boundary.
- **Tests:** any/all/ordered/race/expiry/delegation.
- **Acceptance:** decision immutable and auditable؛ stale version rejected.
- **Rollback:** pause requests؛ preserve decisions.
- **Complexity/Risks:** Extra Large؛ business ambiguity/legal evidence.
- **Exclusions:** client portal UI.

## Prompt 17: Templates and Recurring Work

- **Objective:** project/task/workflow templates، recurrence scheduler.
- **Dependencies:** P12-P16.
- **Modules:** Templates/Scheduler.
- **Docs:** recurrence/timezone/idempotency.
- **Code areas:** template service/jobs/UI.
- **Database:** template definitions/recurrence runs.
- **Security:** creator scope and runAs policy.
- **Tests:** DST، duplicate runs، disabled template، catch-up.
- **Acceptance:** one logical run per occurrence؛ generated work valid.
- **Rollback:** pause recurrence؛ generated tasks retained/marked.
- **Complexity/Risks:** Large؛ duplicate tasks.
- **Exclusions:** general automation engine.

### Quality Gate after Prompt 17

- Security: task/workflow/review/template permission matrix and client visibility probes.
- Data: immutable versions، execution history، recurrence dedupe، staging V1 task mapping.
- Tests: critical workflow examples E2E + race/property tests.
- Performance: queue age، task queries، execution write costs.
- Docs: workflow examples/runbooks/migration updated.
- Decision: lost history، duplicate transition، mutable approval = **STOP**.

## Prompt 18: Comments and Collaboration

- **Objective:** internal/client comments، mentions، reactions، watchers/activity.
- **Dependencies:** Gate 17؛ OD-COM-*.
- **Modules:** Comment/Notification event.
- **Docs:** visibility/edit/delete policy.
- **Code areas:** Comment service/task/project UI.
- **Database:** comments/mentions/reactions/watchers.
- **Security:** internal projection separate؛ sanitize/limits.
- **Tests:** client leakage، mentions، edit window، tombstone.
- **Acceptance:** no internal comment accessible via portal APIs.
- **Rollback:** disable create، retain history.
- **Complexity/Risks:** Large؛ disclosure/abuse.
- **Exclusions:** real-time chat.

## Prompt 19: Secure File Management

- **Objective:** signed upload/finalize، scan، versions، retention/delete/share.
- **Dependencies:** Gate 17؛ OD-FIL-*.
- **Modules:** File/Storage/Scanner.
- **Docs:** provider/threat/retention/runbook.
- **Code areas:** file service/workers/UI.
- **Database:** files/fileVersions/attachments.
- **Security:** private default، checksum، AV، allowlists.
- **Tests:** malicious size/type/key، signed expiry، quarantine، delete saga.
- **Acceptance:** no permanent public URL؛ object/metadata reconcile.
- **Rollback:** pause uploads/shares؛ preserve objects.
- **Complexity/Risks:** Extra Large؛ provider/cost/malware.
- **Exclusions:** Drive migration until integration approved.

## Prompt 20: Notification Center

- **Objective:** inbox/preferences/email delivery/digests/retries.
- **Dependencies:** P18-P19 + events؛ OD-NOT-*.
- **Modules:** Notification.
- **Docs:** event-channel matrix.
- **Code areas:** service/workers/UI.
- **Database:** notifications/preferences/delivery projection.
- **Security:** payload minimization، unsubscribe/quiet hours.
- **Tests:** dedupe، provider retry/DLQ، locale/timezone.
- **Acceptance:** no duplicate logical notification؛ delivery observable.
- **Rollback:** disable channels؛ in-app retained.
- **Complexity/Risks:** Large؛ spam/provider failures.
- **Exclusions:** SMS/WhatsApp unless separate decision.

### Quality Gate after Prompt 20

- Security: comments/files/notification payload leakage and signed access tests.
- Data: file-object reconciliation، retention states، notification dedupe.
- Tests: E2E collaboration/file/review notifications.
- Performance: upload budgets، notification queue/load.
- Docs: incident/delete/provider runbooks.
- Decision: public file path، unscanned download، internal leak = **STOP**.

## Prompt 21: Workload and Capacity

- **Objective:** schedules/capacity/allocation planning and views.
- **Dependencies:** Gate 20؛ tasks/people؛ OD-WLD-*.
- **Modules:** Capacity/Workload.
- **Docs:** formulas and privacy.
- **Code areas:** aggregation jobs/read models/UI.
- **Database:** capacityPlans/projections.
- **Security:** team/org view scopes.
- **Tests:** leave/part-time/overlap/unknown capacity.
- **Acceptance:** unknown not zero؛ metrics explainable.
- **Rollback:** disable projections؛ tasks unaffected.
- **Complexity/Risks:** Large؛ misleading data.
- **Exclusions:** auto-reassignment.

## Prompt 22: Time Tracking and Timesheets

- **Objective:** timer/entries/submit/approve/corrections.
- **Dependencies:** P21؛ OD-TIM-*.
- **Modules:** Time/Timesheet.
- **Docs:** rounding/billable/locking.
- **Code areas:** services/jobs/UI.
- **Database:** timeEntries/timesheets.
- **Security:** HR/financial scopes.
- **Tests:** overlap، idempotent timer، period lock، timezone.
- **Acceptance:** approved entries immutable؛ corrections audited.
- **Rollback:** stop timers safely؛ export/reconcile entries.
- **Complexity/Risks:** Extra Large؛ payroll-grade expectations.
- **Exclusions:** payroll/invoicing.

## Prompt 23: Attendance and Leave

- **Objective:** schedules/attendance/exceptions/leave approval/capacity effect.
- **Dependencies:** P8,P21-P22؛ OD-ATT/LEV.
- **Modules:** Attendance/Leave.
- **Docs:** privacy/labor policy.
- **Code areas:** services/jobs/UI.
- **Database:** schedules/holidays/attendance/leave.
- **Security:** field-level HR access، correction AE.
- **Tests:** overlap، holidays، DST، manager scope، revoke.
- **Acceptance:** leave affects capacity once؛ no silent correction.
- **Rollback:** disable ingestion/approvals؛ preserve records.
- **Complexity/Risks:** Extra Large؛ legal/business rules.
- **Exclusions:** biometric integration/payroll.

## Prompt 24: KPIs, Reports and Exports

- **Objective:** versioned definitions، aggregates، scoped reports، async export.
- **Dependencies:** P21-P23؛ OD-MET/FIN/PRV.
- **Modules:** KPI/Reporting/Search/Warehouse.
- **Docs:** metric dictionary/data lineage.
- **Code areas:** jobs/read APIs/report UI.
- **Database:** definitions/measurements/exportJobs؛ warehouse optional.
- **Security:** performance/financial projections، export expiry.
- **Tests:** formula fixtures، attribution، scope، reproducibility.
- **Acceptance:** same cutoff/version => same result؛ no hidden metric.
- **Rollback:** stop new calculations؛ retain versioned measurements.
- **Complexity/Risks:** Extra Large؛ harmful/inaccurate metrics.
- **Exclusions:** autonomous performance decisions.

### Quality Gate after Prompt 24

- Security: HR/financial/report/export field matrix.
- Data: time/attendance/leave reconciliation and KPI lineage.
- Tests: period/timezone/formula/export E2E.
- Performance: report P95، async queue، Firestore/warehouse cost.
- Docs: metric definitions/privacy approvals.
- Decision: unreproducible KPI أو unauthorized export = **STOP**.

## Prompt 25: Automation Engine

- **Objective:** event/schedule rules، conditions/actions، runs، DLQ/replay.
- **Dependencies:** Gate 24؛ stable commands/events؛ OD-AUT-*.
- **Modules:** Automation/Event.
- **Docs:** action catalog/risk/runbook.
- **Code areas:** service/Run worker/builder/runs.
- **Database:** automations/runs/idempotency.
- **Security:** runAs least privilege، publish permission، quotas.
- **Tests:** replay/dedupe/loops/rate/failure.
- **Acceptance:** bounded loop prevention؛ every action traceable.
- **Rollback:** pause automation، drain queue، compensations.
- **Complexity/Risks:** Extra Large؛ runaway actions/cost.
- **Exclusions:** arbitrary user code.

## Prompt 26: AI Assistant

- **Objective:** redacted AI requests، summaries/proposals، human approval.
- **Dependencies:** P25 + audit/files/search؛ OD-AI-*.
- **Modules:** AI Gateway/Proposal.
- **Docs:** model/data/risk/evaluation policy.
- **Code areas:** isolated Run service/UI.
- **Database:** aiRequests/proposals with short retention.
- **Security:** prompt injection، data minimization، target permission.
- **Tests:** redaction، malicious content، cost/timeouts، eval set.
- **Acceptance:** no high-risk direct action؛ proposal hash checked.
- **Rollback:** kill switch/provider disable؛ no domain corruption.
- **Complexity/Risks:** Extra Large؛ privacy/hallucination/cost.
- **Exclusions:** autonomous HR/financial/security decisions.

## Prompt 27: Client Portal and Final UX

- **Objective:** external identity، portal projections، requests/approvals/delivery، final RTL/accessibility.
- **Dependencies:** Gate 24، P18-P20، P26 optional؛ OD-CLI-*.
- **Modules:** Portal/Auth/Client/Approval/File/Notification.
- **Docs:** portal threat/visibility/content matrix.
- **Code areas:** separate portal shell/endpoints/E2E.
- **Database:** client memberships/requests/projections.
- **Security:** client account/project/internal isolation، token/session.
- **Tests:** cross-client/cross-org، internal leakage، mobile/WCAG.
- **Acceptance:** no internal payload reaches portal؛ client approval evidence complete.
- **Rollback:** disable portal flag/revoke sessions؛ internal ops continue.
- **Complexity/Risks:** Extra Large؛ disclosure/reputation.
- **Exclusions:** SaaS self-service billing/white-label كامل.

### Quality Gate after Prompt 27

- Security: independent portal penetration/visibility matrix، file/comment leakage.
- Data: client/project memberships and approval versions reconciled.
- Tests: all personas E2E، WCAG، Arabic RTL + English smoke.
- Performance: mobile budgets، portal query/load.
- Docs: client support/privacy/incident runbooks.
- Decision: any cross-client/internal exposure = **STOP**.

## Prompt 28: Production Readiness and Launch

- **Objective:** migrate، harden، observe، backup/restore، staged launch.
- **Dependencies:** all prior gates، P0 owner decisions.
- **Modules:** whole platform/infra/migration.
- **Docs:** launch/rollback/on-call/DR/data maps.
- **Code areas:** CI/CD/infra/rules/migrations/monitoring.
- **Database:** staged rehearsals، final delta، cutover؛ no direct-first production.
- **Backend:** capacity/SLO/alerts/DLQ/runbooks.
- **Security:** threat review، dependency/SAST/DAST/rules، key rotation.
- **Tests:** full regression/load/chaos/restore/migration/security.
- **Acceptance:** all launch checklist and owner sign-off؛ error budgets green.
- **Rollback:** tested feature/cohort/database/integration rollback.
- **Complexity/Risks:** Extra Large؛ migration/outage/data loss.
- **Exclusions:** post-launch new features.

### Quality Gate after Prompt 28

- **Security:** independent review، zero unresolved Critical/High launch blockers، secrets rotated.
- **Data:** backups/restores، migration counts/references/tenant checks، rollback rehearsal.
- **Tests:** CI clean، E2E personas، load/SLO، disaster recovery.
- **Performance:** production-like P75/P95، queue/storage/query budgets.
- **Docs:** owner decisions closed، runbooks/on-call/support/training complete.
- **Decision:** only explicit accountable launch authority may **GO**؛ otherwise **STOP**. Production readiness هو final milestone.

