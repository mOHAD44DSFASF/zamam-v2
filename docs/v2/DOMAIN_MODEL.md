# النموذج الدوميني المعتمد لـZAMAM V2

> **Proposed V2.** هذه الوثيقة هي المرجع الدلالي قبل تصميم Firestore أو UI. أي تعارض لاحق يحسم لصالح invariants هنا بعد اعتماد قرارات المالك.

## 1. قواعد مشتركة

كل كيان tenant-owned يملك:

`id`, `organizationId`, `schemaVersion`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `version`, `status`، وعند الحاجة `archivedAt`, `archivedBy`, `deletedAt`, `deletedBy`.

- `organizationId` غير قابل للتغيير.
- التوقيت backend-generated UTC Timestamp.
- `version` رقم optimistic concurrency يبدأ من 1.
- الإنشاء والتعديل عبر trusted backend command إلا القراءات والعمليات منخفضة المخاطر المصرح بها صراحة.
- hard delete ممنوع افتراضياً؛ purge عملية retention منفصلة.
- كل sensitive command ينتج `AuditEvent`.
- الحقول المالية/الوظيفية/الهوية/AI prompts/file access حساسة.

اختصارات الجداول:

- **Org**: tenant-owned ويحمل `organizationId`.
- **Global**: control-plane/identity؛ لا يحمل tenant business data.
- **A**: archive فقط ثم purge policy.
- **S**: soft-delete.
- **I**: immutable بعد النشر/القرار.
- **AE**: audit event إلزامي لكل mutation.

## 2. Organization and Identity

| Entity | الغرض والملكية | الحقول/status | العلاقات | إنشاء/تعديل/حذف | الحساسية والتدقيق | queries ومصدر V1 |
|---|---|---|---|---|---|---|
| Tenant / Organization | tenant root؛ Global control plane | `name,slug,status,plan,primaryLocale,timeZone` | settings, memberships, all Org entities | platform provision؛ Owner edits؛ suspend/purge controlled | AE؛ tenant metadata sensitive | by slug/id؛ لا مصدر مباشر V1، organization واحدة inferred |
| Organization Settings | سياسات المنظمة؛ Org | `organizationId,locale,timeZone,weekStart,retention,security,filePolicy,featureFlags` | Organization | Owner/settings permission؛ versioned؛ A | AE لكل security/retention | single doc؛ من `settings/general` جزئياً |
| User | Auth identity عالمي | `authUid,accountStatus,primaryEmailHash,emailVerified,lastAuthAt` | profiles/memberships | Auth adapter فقط؛ disable/revoke؛ لا business role | PII؛ AE؛ لا email raw في broad queries | by authUid؛ من Firebase Auth |
| User Profile | ملف شخصي عالمي محدود | `displayName,avatarRef,preferredLocale,preferredTimeZone` | User | self editable ضمن field policy | PII؛ AE للحقول الحساسة | by userId؛ من `users.displayName` |
| Employment Profile | علاقة عمل داخل Org | `userId,employeeCode,type,status,jobTitle,departmentId,managerId,startDate,endDate,costRate?,workScheduleId` | membership, department, schedule | HR permission؛ S/A؛ departure workflow | HR/financial sensitive؛ AE | employee directory/manager؛ من `users.role` جزئياً |
| Role | حزمة permissions داخل Org | `name,key,status,isSystem,description` | role assignments | role.manage؛ system role immutable؛ A | AE | active roles؛ من `roles` |
| Permission | catalog عالمي versioned | `key,description,riskLevel,resourceType` | roles/policy engine | platform release فقط؛ I per version | security critical؛ AE | lookup by key؛ لا مصدر V1 |
| Role Assignment | role + scope لمستخدم | `principalId,roleId,scopeType,scopeId,effect,status,startsAt,endsAt` | membership/role/resource | role.assign scoped؛ S/revoke | security critical؛ AE | active assignments by principal/org/scope؛ من `users.role` |
| Team Membership | عضوية فريق | `teamId,userId,membershipRole,status,capacityPercent,joinedAt,leftAt` | Team/Employment | team.manage؛ no overlap contradiction؛ S | performance scope؛ AE | members by team/user | من `workspaces.members/supervisors` يحتاج قرار |

## 3. Organization Structure

| Entity | الغرض والملكية | الحقول/status | العلاقات | lifecycle | الحساسية/audit | queries ومصدر V1 |
|---|---|---|---|---|---|---|
| Department | وحدة إدارية؛ Org | `name,code,status,managerIds,parentDepartmentId?` | teams/employees | department.manage؛ A إذا بلا active dependencies | AE | active tree/list؛ جديد |
| Team | وحدة تنفيذ؛ Org | `name,code,status,departmentId,leaderIds` | memberships/projects | team.manage؛ A | AE | by department/member؛ workspaces ليست migration مؤكدة |
| Work Schedule | ساعات العمل؛ Org | `name,timeZone,weeklyRules,breakRules,effectiveFrom,effectiveTo,status` | employment/attendance | attendance.manage؛ versioned effective dates؛ A | HR sensitive؛ AE | current by employee/date؛ جديد |
| Holiday | إجازة رسمية؛ Org | `name,date,region,paid,status` | schedules/capacity | attendance.manage؛ versioned by year | AE | year/region؛ جديد |
| Capacity Plan | سعة زمنية؛ Org | `subjectType,subjectId,periodStart,periodEnd,availableMinutes,allocatedMinutes,status` | user/team/projects | workload.manage؛ computed+override | performance sensitive؛ AE override | by subject/period؛ جديد |

## 4. Clients, Projects, Workspaces

| Entity | الغرض والملكية | الحقول/status | العلاقات | lifecycle | الحساسية/audit | queries ومصدر V1 |
|---|---|---|---|---|---|---|
| Client | حساب عميل؛ Org | `name,code,status,industry,ownerUserId,visibilityPolicy,billingMetadata?` | contacts/projects | client.manage؛ A، purge retention | PII/financial؛ AE | list/search/owner/status؛ جديد |
| Client Contact | شخص لدى العميل؛ Org | `clientId,userId?,name,emailEncrypted,phoneEncrypted,status,portalAccess` | Client/client membership | client.manage؛ S/revoke | PII؛ AE | by client/status؛ جديد |
| Project | عقد/نتيجة عمل؛ Org | `clientId,name,code,status,ownerId,startDate,dueDate,budget?,currency?,visibility,defaultWorkflowTemplateId` | members/tasks/files | project.manage؛ controlled transitions؛ A | financial optional؛ AE | by client/member/status/due؛ جديد |
| Project Member | access للمشروع؛ Org | `projectId,principalId,memberType,projectRole,status,visibility` | Project/User/Client Contact | project.manage؛ revoke | security sensitive؛ AE | by project/principal؛ جديد |
| Workspace | مساحة تعاون؛ Org | `name,type,status,projectId?,departmentId?,teamIds,visibility` | tasks/members | workspace.manage؛ A؛ لا hard delete مع tasks | AE | by member/project/status؛ من `workspaces` |

## 5. Work Management

| Entity | الغرض والملكية | الحقول/status | العلاقات | lifecycle | الحساسية/audit | queries ومصدر V1 |
|---|---|---|---|---|---|---|
| Task | وحدة عمل accountable؛ Org | `projectId?,workspaceId?,parentTaskId?,title,description,status,priority,startAt,dueAt,completedAt,ownerId,workflowInstanceId?,visibility,estimateMinutes,sequence` | assignments/subtasks/workflow/comments/files | task.create/update؛ completed locks core fields؛ A | AE transitions/deadline/ownership | my/team/project/overdue؛ من `tasks` |
| Subtask | child task مستقل progress؛ Org | نفس Task + `parentTaskId,inheritVisibility` | parent Task | نفس Task؛ منع cycles | AE | by parent/status؛ من pipeline لا mapping مباشر |
| Checklist | قائمة شروط؛ Org | `taskId,stageExecutionId?,title,status,requiredForTransition` | items | task.update أو workflow engine؛ A with task | audit completion إذا gate | by task/stage؛ جديد |
| Checklist Item | شرط granular؛ Org | `checklistId,text,status,required,completedBy,completedAt,order` | Checklist | authorized assignee/reviewer؛ reset audited | AE إذا required | by checklist order؛ جديد |
| Task Assignment | مسؤولية؛ Org | `taskId,assigneeType,assigneeId,assignmentRole,status,startsAt,endsAt,claimedAt` | Task/User/Team | task.assign؛ atomic claim/reassign | AE | active by assignee/task؛ من `pipeline.assigneeId/role` |
| Task Watcher | متابعة notifications؛ Org | `taskId,principalId,status,source` | Task/User | self or task.manage؛ S | low sensitivity؛ audit admin add | by principal/task؛ جديد |
| Tag | تصنيف؛ Org | `name,color,status,appliesTo` | join IDs on resources | tag.manage؛ merge/A | AE merge | by name/status؛ جديد |
| Saved View | query محفوظ؛ Org | `ownerId,name,resourceType,scope,filters,sort,columns,visibility,status` | User/Team | owner/manage؛ S | may reveal filter intent؛ AE shared | by owner/resource؛ جديد |
| Custom Field Definition | schema امتداد؛ Org | `key,label,type,resourceTypes,validation,options,sensitivity,status` | values | settings.manage؛ version/A | AE؛ sensitive flag | by resource/status؛ جديد |
| Custom Field Value | قيمة typed؛ Org | `definitionId,resourceType,resourceId,value,valueType` | Definition/resource | resource update + schema validation؛ S with resource | inherits sensitivity؛ AE when flagged | by resource/definition؛ جديد |

## 6. Workflow, Review and Approval

| Entity | الغرض والملكية | الحقول/status | العلاقات | lifecycle | الحساسية/audit | queries ومصدر V1 |
|---|---|---|---|---|---|---|
| Workflow Template | هوية workflow؛ Org | `name,key,status,currentPublishedVersionId,appliesTo` | versions | workflow.manage؛ A | AE | active templates؛ من task pipeline concept |
| Workflow Version | snapshot منشور؛ Org | `templateId,versionNumber,status,publishedAt,publishedBy,definitionHash` | stages/transitions/instances | draft editable؛ published I؛ archive | AE publish/migrate | by template/version/status؛ جديد |
| Workflow Stage | node داخل version؛ Org | `workflowVersionId,key,name,type,order,slaMinutes,actorRule,entryRequirements,exitRequirements` | transitions/executions | mutable draft فقط؛ I بعد publish | AE via version | by version/order؛ من `pipeline[]` |
| Workflow Transition | edge؛ Org | `workflowVersionId,key,fromStageId,toStageId,action,conditions,requiredPermission,isOverride` | stages | draft only ثم I | security/business critical؛ AE | by version/from/action؛ جديد |
| Task Workflow Instance | execution pinned؛ Org | `taskId,workflowVersionId,status,currentStageId,startedAt,completedAt,lockVersion` | executions | engine only؛ migration explicit | AE every transition | by task/status/stage؛ من `currentStage` |
| Task Stage Execution | محاولة stage/history؛ Org | `instanceId,stageId,cycle,status,enteredAt,exitedAt,actorSnapshot,slaDueAt,outcome` | reviews/files/checklists | engine append/update current؛ never overwrite history | AE; immutable on exit | queue by actor/stage/SLA؛ لا history V1 |
| Review Request | طلب مراجعة versioned؛ Org | `taskId,stageExecutionId,subjectType,subjectVersion,reviewerRule,status,dueAt,cycle` | approvals/change requests | workflow/reviewer؛ I after close | AE | reviewer inbox/status/due؛ approval flag V1 غير منفذ |
| Approval | قرار reviewer؛ Org | `reviewRequestId,reviewerId,decision,decidedAt,reviewedVersion,commentId?,delegatedFrom?` | Review Request | reviewer only؛ append-only، correction creates superseding record | highly sensitive؛ AE | by request/reviewer؛ جديد |
| Change Request | طلب rework؛ Org | `reviewRequestId,requestedBy,reason,items,status,resolvedAt,resolutionVersion` | Review/task execution | reviewer create؛ assignee resolve؛ retain | AE | open by task/assignee؛ جديد |

## 7. Collaboration and Files

| Entity | الغرض والملكية | الحقول/status | العلاقات | lifecycle | الحساسية/audit | queries ومصدر V1 |
|---|---|---|---|---|---|---|
| Comment | نقاش contextual؛ Org | `resourceType,resourceId,authorId,body,status,visibility,editedAt,parentCommentId?` | mentions/reactions | create permission؛ edit window OD-COM-01؛ tombstone | internal/client boundary؛ AE visibility/delete | by resource/time؛ جديد |
| Mention | إشعار مرجع؛ Org | `commentId,mentionedPrincipalId,status` | Comment/Notification | parser backend؛ immutable | AE if external | by principal/unread؛ جديد |
| Reaction | تفاعل؛ Org | `commentId,principalId,type,status` | Comment | one per type/principal؛ S | low | by comment؛ جديد |
| Attachment | ارتباط ملف بresource؛ Org | `resourceType,resourceId,fileId,visibility,displayName,status,retentionState` | File Versions | file.attach permission؛ A/tombstone | access sensitive؛ AE | by resource/status؛ من `tasks.attachments/fileLink` |
| File Version | object metadata/version؛ Org | `fileId,versionNumber,storageProvider,objectKey,checksum,size,mimeType,scanStatus,status,uploadedBy` | Attachment/reviews | signed upload finalize؛ I bytes؛ quarantine/delete policy | never public by default؛ AE access/delete | latest/by file/version؛ من URLs بلا version |

## 8. Communication

| Entity | الغرض والملكية | الحقول/status | العلاقات | lifecycle | الحساسية/audit | queries ومصدر V1 |
|---|---|---|---|---|---|---|
| Notification | inbox record؛ Org | `recipientId,type,titleKey,payloadRef,status,createdAt,readAt,deliveryState` | events/preferences | service only؛ user read/archive | payload minimized؛ audit admin resend | recipient/status/time؛ UI placeholder V1 |
| Notification Preference | قنوات user؛ Org | `userId,eventType,inApp,email,push,digest,quietHours` | User | self/admin policy | personal prefs؛ AE admin changes | by user/type؛ جديد |

## 9. Time, Attendance and Leave

| Entity | الغرض والملكية | الحقول/status | العلاقات | lifecycle | الحساسية/audit | queries ومصدر V1 |
|---|---|---|---|---|---|---|
| Time Entry | زمن على work؛ Org | `userId,taskId?,projectId?,startedAt,endedAt,durationMinutes,status,billable,note` | Timesheet | self draft؛ submitted locks؛ manager adjust with reason | HR/financial؛ AE | by user/project/period/status؛ جديد |
| Timesheet | تجميع فترة؛ Org | `userId,periodStart,periodEnd,status,totalMinutes,submittedAt,approvedAt,approverId` | Time Entries | submit/approve/reject state machine | HR/financial؛ AE | team/period/status؛ جديد |
| Attendance Record | حضور يومي؛ Org | `userId,workDate,status,checkInAt,checkOutAt,workedMinutes,source,exceptions` | Schedule/leave | device/self per policy؛ manager correction reason | HR sensitive؛ AE | user/team/date/status؛ جديد |
| Leave Type | سياسة إجازة؛ Org | `name,code,status,paid,unit,approvalPolicy,balancePolicy` | Leave requests | leave.manage؛ versioned/A | HR؛ AE | active types؛ جديد |
| Leave Request | طلب إجازة؛ Org | `userId,leaveTypeId,startAt,endAt,quantity,status,reason,approverIds,decidedAt` | Attendance/capacity | employee request؛ scoped approval | HR/private؛ AE | user/team/status/date؛ جديد |

## 10. Goals, KPI and Intelligence

| Entity | الغرض والملكية | الحقول/status | العلاقات | lifecycle | الحساسية/audit | queries ومصدر V1 |
|---|---|---|---|---|---|---|
| Goal | نتيجة مستهدفة؛ Org | `ownerType,ownerId,title,period,target,status,visibility` | KPI measurements | goal.manage؛ close not overwrite | performance sensitive؛ AE | owner/period/status؛ جديد |
| KPI Definition | صيغة metric versioned؛ Org | `key,name,version,formula,dataSources,unit,direction,status,visibility` | measurements | report.manage؛ published I | high governance؛ AE | active by key/version؛ analytics V1 أولي |
| KPI Measurement | نتيجة محسوبة؛ Org | `definitionId,definitionVersion,subjectType,subjectId,period,value,dimensions,calculatedAt,sourceRunId,status` | KPI/Goal | reporting service append؛ correction supersedes | performance sensitive؛ AE correction | subject/period/definition؛ جديد |
| Automation | rule definition؛ Org | `name,status,trigger,conditions,actions,riskLevel,version,runAsPolicy` | runs | automation.manage؛ publish versioned؛ pause | security critical؛ AE | status/trigger؛ جديد |
| Automation Run | execution history؛ Org | `automationId,version,triggerEventId,status,startedAt,endedAt,attempts,actionResults,idempotencyKey` | Audit/events | worker only؛ append/update terminal | payload redacted؛ AE | status/time/automation؛ جديد |
| AI Request | طلب AI؛ Org | `requesterId,purpose,modelPolicy,inputRefs,redactionProfile,status,tokenUsage,costClass` | action proposals | AI gateway only؛ retention policy | highly sensitive؛ AE | requester/status/time؛ جديد |
| AI Action Proposal | اقتراح قابل للمراجعة؛ Org | `aiRequestId,actionType,targetRef,argumentsHash,riskLevel,status,reviewerId,executedCommandId` | AI Request/Audit | propose -> approve/reject/expire/execute | no direct high-risk execution؛ AE | reviewer/status/risk؛ جديد |

## 11. Governance and Integrations

| Entity | الغرض والملكية | الحقول/status | العلاقات | lifecycle | الحساسية/audit | queries ومصدر V1 |
|---|---|---|---|---|---|---|
| Audit Event | سجل append-only؛ Org أو control plane | `actor,action,resource,beforeHash,afterHash,occurredAt,correlationId,ipClass,outcome,metadataRedacted` | كل modules | service only؛ immutable؛ long retention | security record؛ restricted read | org/time/action/resource؛ لا history V1 |
| Integration | connector config؛ Org | `provider,type,status,scopes,credentialRef,configuredBy,lastHealthAt` | Webhooks/jobs | integration.manage؛ secrets external؛ revoke | secret refs only؛ AE | provider/status؛ Drive/R2 V1 جزئي |
| Webhook | endpoint subscription؛ Org | `integrationId,direction,eventTypes,endpointRef,signingSecretRef,status,lastDeliveryAt` | events | verify/rotate/pause؛ no secret value in DB | critical؛ AE | status/provider؛ جديد |

## 12. Domain Invariants

1. كل tenant-owned document يحتوي `organizationId` وتتحقق مطابقته للمسار/resource.
2. لا permission مشتقة من role text أرسله client؛ backend يحل assignments وscope.
3. unknown permission أو scope أو status يؤدي إلى deny.
4. completed task لا يعدل بصمت؛ reopen command بإذن وسبب وAE.
5. transition يتبع `WorkflowVersion` منشورة immutable ومثبتة على instance.
6. active task لا ينتقل لنسخة workflow أخرى إلا migration صريحة مدققة.
7. كل approval يحفظ reviewer والوقت والنتيجة و`reviewedVersion`.
8. كل idempotent command يرفض replay المتعارض ويعيد النتيجة السابقة للـsame key.
9. hard delete محصور في retention service وبعد legal-hold/reference checks.
10. timestamps UTC backend-generated؛ locale للعرض فقط.
11. كل file له owner/resource وretention/scan state؛ لا public URL دائم.
12. client principal لا يرى `visibility=internal`.
13. metrics تسجل waiting/rework attribution ولا تنسب كل delay للassignee.
14. Audit Event append-only ولا يستطيع tenant app تعديله.
15. financial/HR/AI sensitive fields لا تدخل broad indexes أو logs.
16. assignment claim وworkflow transition وapproval decision transaction-safe.

## 13. Status Models

| Model | القيم | الانتقالات المسموحة | الممنوع/المتطلبات | permission/audit |
|---|---|---|---|---|
| User Account | `invited,active,locked,disabled,deleted` | invited->active؛ active<->locked؛ active/locked->disabled؛ disabled->active؛ disabled->deleted by retention | client لا يفعّل نفسه؛ deleted terminal | `user.invite/disable/restore`; AE + token revoke |
| Employment | `planned,active,on_leave,suspended,ended` | planned->active؛ active<->on_leave؛ active->suspended/ended؛ suspended->active/ended | ended لا يعود؛ ينشأ profile جديد عند rehire حسب OD-EMP-01 | `employment.manage`; AE |
| Client | `lead,active,on_hold,archived` | lead->active/archived؛ active<->on_hold؛ active/on_hold->archived؛ archived->active بإذن | لا purge مع projects/retention | `client.manage/archive`; AE |
| Project | `draft,planned,active,on_hold,completed,cancelled,archived` | draft->planned/cancelled؛ planned->active؛ active<->on_hold؛ active->completed/cancelled؛ terminal->archived؛ completed->active عبر reopen | completed يتطلب open tasks policy؛ no direct draft->completed | `project.manage/archive/reopen`; AE |
| Workspace | `active,read_only,archived` | active<->read_only؛ active/read_only->archived؛ restore بإذن | archive لا يحذف tasks | `workspace.manage/archive`; AE |
| Task | `draft,ready,in_progress,blocked,in_review,waiting_approval,changes_requested,completed,cancelled,archived` | عبر workflow؛ completed->in_progress فقط reopen؛ terminal->archived | لا arbitrary jump؛ required gates؛ version match | `task.transition/reopen/archive`; AE |
| Workflow Execution | `not_started,running,waiting,completed,cancelled,failed,migrating` | not_started->running؛ running<->waiting؛ running->completed/cancelled/failed؛ failed->running retry؛ running/waiting->migrating->running | completed terminal إلا explicit restart/new instance | workflow engine permission; AE |
| Review | `draft,requested,in_progress,changes_requested,approved,rejected,cancelled,expired` | draft->requested؛ requested->in_progress/cancelled/expired؛ in_progress->approved/rejected/changes_requested؛ changes_requested->requested new cycle | terminal decision immutable | `review.request/decide`; AE |
| Approval | `pending,approved,rejected,changes_requested,delegated,expired,cancelled` | pending->one terminal/delegated؛ delegated creates recipient decision | reviewer cannot approve unreviewed version؛ one effective decision per policy slot | `task.approve`; AE |
| File | `uploading,processing,available,quarantined,archived,pending_delete,deleted,failed` | uploading->processing/failed؛ processing->available/quarantined/failed؛ available->archived/quarantined/pending_delete؛ pending_delete->deleted/available restore | quarantined no download؛ deleted terminal metadata retained | `file.upload/download/delete/restore`; AE |
| Notification | `queued,sent,delivered,failed,read,archived` | queued->sent/failed؛ sent->delivered/failed؛ delivered->read؛ read->archived؛ failed->queued retry | user cannot mark another recipient | recipient read; admin retry AE |
| Time Entry | `running,draft,submitted,approved,rejected,locked,voided` | running->draft؛ draft->submitted/voided؛ submitted->approved/rejected؛ rejected->draft؛ approved->locked؛ correction supersedes | no overlap per policy؛ locked immutable | `time.track/approve/adjust`; AE adjust |
| Timesheet | `open,submitted,approved,rejected,locked` | open->submitted؛ submitted->approved/rejected؛ rejected->open؛ approved->locked | period/entries consistent | `timesheet.submit/approve`; AE |
| Attendance | `expected,present,absent,late,partial,on_leave,holiday,exception,corrected` | computed daily؛ correction creates reason/version | no silent overwrite؛ leave/holiday priority defined | `attendance.record/manage`; AE corrections |
| Leave Request | `draft,submitted,pending_approval,approved,rejected,cancelled,withdrawn` | draft->submitted； submitted->pending/approved/rejected/cancelled؛ pending->approved/rejected/cancelled؛ approved->withdrawn/cancelled by policy | overlap/balance checked؛ past leave restriction | `leave.request/approve/manage`; AE |
| Automation | `draft,active,paused,disabled,archived` | draft->active؛ active<->paused؛ any->disabled؛ disabled->draft clone؛ terminal archived | active requires validated actions/risk owner | `automation.manage/publish`; AE |
| Automation Run | `queued,running,succeeded,partially_failed,failed,retrying,cancelled,dead_lettered` | queue->run؛ run->terminal/retrying؛ retrying->run/dead-letter | bounded attempts؛ same idempotency no duplicate action | worker only; AE summary |
| AI Action | `proposed,awaiting_review,approved,rejected,expired,executing,executed,failed,revoked` | proposed->awaiting/expired؛ awaiting->approved/rejected/expired؛ approved->executing/revoked؛ executing->executed/failed | high risk always human approval؛ reviewed args hash fixed | `ai.use/ai.approve/target permission`; AE |

## 14. Owner Decisions

القرارات التي تغير invariants أو lifecycle لا تُحسم هنا: `OD-ORG-01`, `OD-EMP-01`, `OD-TSK-01..03`, `OD-WFL-01..04`, `OD-FIL-01..03`, `OD-TIM-*`, `OD-ATT-*`, `OD-AI-*`. المرجع الكامل في `OWNER_DECISIONS.md`.
