# نموذج البيانات الدائم لـZAMAM V2

> **Proposed V2، Firestore-compatible.** لا ينشئ هذا المستند collections أو indexes. كل writes التجارية عبر backend. يظل Firestore operational store، مع قابلية نقل analytics المعقدة لاحقاً.

## 1. قرارات التخزين

### 1.1 Tenant root

```text
/organizations/{organizationId}
  /settings/{settingId}
  /members/{userId}
  /departments/{departmentId}
  /teams/{teamId}
  /...
```

كل document تحت tenant root يحتوي أيضاً `organizationId`. هذا duplication مقصود لفحص backend/rules وcollection-group exports.

Global collections محدودة:

```text
/users/{userId}                         # identity/profile غير tenant business
/users/{userId}/organizationRefs/{organizationId}
/permissionCatalog/{permissionKey}      # platform-controlled
/platformIdempotency/{keyHash}          # control-plane فقط عند الحاجة
```

`organizationRefs` لا تمنح access؛ هي lookup hint. العضوية authoritative هي `/organizations/{orgId}/members/{userId}`.

### 1.2 IDs and envelope

- IDs: UUIDv7/ULID backend-generated؛ Auth UID فقط للمستخدم.
- stable keys: permission key وorganization slug بعد uniqueness reservation.
- common required fields: `organizationId:string`, `schemaVersion:int`, `status:string`, `createdAt:Timestamp`, `createdBy:string`, `updatedAt:Timestamp`, `updatedBy:string`, `version:int`.
- soft-delete optional: `deletedAt:Timestamp?`, `deletedBy:string?`, `deletionReason:string?`.
- لا raw secrets أو permanent public file URLs.

### 1.3 Type notation

`s` string، `i` integer، `b` boolean، `t` Timestamp UTC، `m` map، `a<T>` array، `r` ID reference، `e<>` enum. `*` required، `?` optional، `d:` denormalized.

### 1.4 Write authorities

- `AUTH`: authentication adapter.
- `CMD`: trusted command API.
- `WFE`: workflow engine.
- `JOB`: background worker.
- `AUD`: append-only audit writer.
- clients read only through rules/API; حتى low-risk writes تمر commands في أول production release.

## 2. Global Collections

| Path/entity | fields الإضافية | references/denormalization | query/index | write/retention/audit | migration/growth |
|---|---|---|---|---|---|
| `/users/{userId}` User + Profile | `authUid*,accountStatus*,primaryEmailHash*,emailVerified*,displayName*,avatarFileId?,locale*,timeZone*,lastAuthAt?` | لا roles؛ no org data | authUid unique reservation؛ accountStatus | AUTH؛ retain identity tombstone؛ AE disable | Firebase Auth + `users`; PII |
| `/users/{uid}/organizationRefs/{orgId}` | `organizationId*,membershipStatus*,organizationNameSnapshot,slugSnapshot,lastUsedAt?` | hint إلى member | by status/lastUsed | CMD mirror؛ purge after membership retention | جديد؛ عدد organizations/user صغير |
| `/permissionCatalog/{key}` Permission | `key*,descriptionKey*,resourceType*,riskLevel*,catalogVersion*` | immutable release data | key direct | platform deploy only؛ permanent؛ AE release | جديد؛ صغير |

## 3. Organization, Identity and Structure Collections

| Path/entity | required/optional fields | refs وdenormalized | indexes/query patterns | authority، retention، delete، audit، migration، risk |
|---|---|---|---|---|
| `/organizations/{orgId}` Organization | `name*,slug*,status:e<provisioning,active,suspended,closed>*,primaryLocale*,timeZone*,plan?` | d:memberCount? aggregate | slug reservation؛ status | platform CMD؛ close then retention؛ AE؛ V1 synthetic org؛ low |
| `settings/{id}` Organization Settings | `category*,payload*,policyVersion*` | refs by IDs only | direct docs: general/security/files/retention/features | CMD؛ version history in audit/config archive؛ `settings/general`; low |
| `members/{userId}` Organization Membership | `userId*,membershipStatus*,memberType*,joinedAt*,leftAt?,effectivePermissionVersion*` | d:displayName,avatar,departmentIds,teamIds for UI only | status+displayName; departmentIds array; teamIds array | CMD; S; AE; from `users`; medium |
| `employmentProfiles/{id}` | `userId*,employeeCode*,employmentType*,employmentStatus*,jobTitle*,departmentId?,managerId?,startDate*,endDate?,costRateEncrypted?,workScheduleId?` | d:managerName optional | userId; department+status; manager+status | CMD/HR; long HR retention; AE; role inference فقط؛ medium |
| `roles/{roleId}` | `key*,name*,status*,isSystem*,permissionKeys:a<s>*` | permission catalog keys | status+name | CMD; archive; AE; from `roles`; low |
| `roleAssignments/{id}` | `principalId*,roleId*,scopeType*,scopeId*,effect:e<grant,deny>*,startsAt*,endsAt?` | d:roleKey | principal+status+time; scopeType+scopeId+status | CMD; revoke not delete; AE; from `users.role`; high growth moderate |
| `departments/{id}` | `name*,code*,status*,managerIds:a<r>,parentDepartmentId?` | d:path/name | status+name; parent+status | CMD; archive; AE; new |
| `teams/{id}` | `name*,code*,status*,departmentId?,leaderIds:a<r>` | d:departmentName | department+status+name | CMD; archive; AE; workspace mapping owner decision |
| `teamMemberships/{id}` | `teamId*,userId*,membershipRole*,status*,capacityPercent*,joinedAt*,leftAt?` | d:user/team names optional | team+status; user+status | CMD; S; AE; from workspace arrays after review; medium |
| `workSchedules/{id}` | `name*,status*,timeZone*,weeklyRules:m*,breakRules:m,effectiveFrom*,effectiveTo?` | none | status+effectiveFrom | CMD; version/archive; AE; new |
| `holidays/{id}` | `name*,date*,region*,paid*,status*` | none | region+date; status+date | CMD; annual retention; AE; new |
| `capacityPlans/{id}` | `subjectType*,subjectId*,periodStart*,periodEnd*,availableMinutes*,allocatedMinutes*,status*` | d:subjectName | subject+period; period+status | JOB/CMD override; retain reporting; AE override; high yearly |

## 4. Clients, Projects and Workspaces

| Path/entity | fields | refs/denormalization | indexes/queries | lifecycle/migration/risk |
|---|---|---|---|---|
| `clients/{id}` | `name*,code*,status:e<lead,active,on_hold,archived>*,industry?,ownerUserId*,visibilityPolicy:m,billingRef?` | d:activeProjectCount | status+name; owner+status; searchId? | CMD; archive; AE; new; medium |
| `clientContacts/{id}` | `clientId*,userId?,name*,emailCipher?,phoneCipher?,status*,portalAccess*` | d:clientName | client+status; userId | CMD; revoke/S; AE; new; PII |
| `projects/{id}` | `clientId*,name*,code*,status*,ownerId*,departmentId?,startAt?,dueAt?,budgetCipher?,currency?,visibility*,defaultWorkflowTemplateId?` | d:clientName,ownerName,taskCounters | member/status/due through memberships and indexes | CMD; archive; AE; new; high |
| `projectMembers/{id}` | `projectId*,principalType*,principalId*,projectRole*,status*,visibility*` | d:principalName | project+status; principal+status | CMD; revoke; AE; new; medium |
| `workspaces/{id}` | `name*,type*,status*,projectId?,departmentId?,teamIds:a<r>,visibility*` | d:projectName/memberCount | project+status; teamIds+status | CMD; archive; AE; from `workspaces`; medium |
| `workspaceMembers/{id}` | `workspaceId*,principalId*,membershipRole*,status*` | d:name | workspace+status; principal+status | CMD; revoke; AE; from members/supervisors arrays |

## 5. Tasks and Extension Data

| Path/entity | fields | refs/denormalization | indexes/queries | lifecycle/migration/risk |
|---|---|---|---|---|
| `tasks/{id}` Task/Subtask | `projectId?,workspaceId?,parentTaskId?,kind:e<task,subtask>*,title*,description?,status*,priority*,ownerId*,visibility*,startAt?,dueAt?,completedAt?,estimateMinutes?,workflowInstanceId?,sequence*` | d:project/client/workspace names, activeAssigneeIds, activeTeamIds, currentStageKey, counters, searchTextNormalized | see index plan؛ cursor pagination | CMD/WFE; archive; AE; from `tasks`; highest growth |
| `taskAssignments/{id}` | `taskId*,assigneeType*,assigneeId*,assignmentRole*,status*,startsAt*,endsAt?,claimedAt?` | d:taskStatus,dueAt,title short | assignee+status+due; task+status | CMD/WFE transaction; revoke; AE; from pipeline |
| `taskWatchers/{id}` | `taskId*,principalId*,status*,source*` | none | principal+status; task+status | CMD; S; low |
| `checklists/{id}` | `taskId*,stageExecutionId?,title*,status*,requiredForTransition*` | d:itemCounts | task+status; stageExecution | CMD/WFE; archive with task; AE gates; new |
| `checklistItems/{id}` | `checklistId*,taskId*,text*,status*,required*,order*,completedBy?,completedAt?` | d:stageExecutionId | checklist+order; task+status | CMD; reset AE; medium |
| `tags/{id}` | `name*,normalizedName*,color?,status*,appliesTo:a<s>` | none | status+normalizedName | CMD; merge/archive; AE |
| `resourceTags/{id}` | `tagId*,resourceType*,resourceId*` | d:tagName/color | resource+tag; tag+resourceType | CMD; hard remove allowed with AE; high |
| `savedViews/{id}` | `ownerId*,name*,resourceType*,scope*,filters:m*,sort:a<m>*,columns:a<s>,visibility*,status*` | none | owner+resource+status; visibility | CMD; S; filter schema version; new |
| `customFieldDefinitions/{id}` | `key*,label:m*,type*,resourceTypes:a<s>*,validation:m*,options:a<m>?,sensitivity*,status*` | none | resourceTypes array+status | CMD; archive; AE |
| `customFieldValues/{id}` | `definitionId*,resourceType*,resourceId*,valueType*,value:*` | d:definitionKey | resource+definition; definition+typed sortable field where allowed | CMD; S; AE sensitive; unbounded -> external search/SQL candidate |

## 6. Workflow, Review and Approval

| Path/entity | fields | refs/denormalization | indexes/queries | lifecycle/migration/risk |
|---|---|---|---|---|
| `workflowTemplates/{id}` | `key*,name*,status*,appliesTo:a<s>,currentPublishedVersionId?` | d:versionNumber | status+name; appliesTo+status | CMD; archive; AE; pipelines become candidates |
| `workflowVersions/{id}` | `templateId*,versionNumber*,status*,definitionHash*,publishedAt?,publishedBy?,compatibility:m*` | none | template+version desc; template+status | CMD publish; I; permanent while referenced |
| `workflowStages/{id}` | `workflowVersionId*,key*,name*,type*,order*,actorRule:m*,sla:m?,entryRequirements:m,exitRequirements:m` | d:templateId | version+order | draft CMD then I; from pipeline |
| `workflowTransitions/{id}` | `workflowVersionId*,key*,fromStageId*,toStageId*,action*,conditions:m*,requiredPermission*,isOverride*` | d:fromKey,toKey | version+from+action | draft CMD then I; high read cache |
| `workflowInstances/{id}` | `taskId*,workflowVersionId*,status*,currentStageId*,startedAt*,completedAt?,lockVersion*` | d:task/project/assignee/status/due | taskId; currentStage+status; status+SLA | WFE only; permanent history; from currentStage |
| `stageExecutions/{id}` | `instanceId*,taskId*,stageId*,cycle*,status*,enteredAt*,exitedAt?,slaDueAt?,actorSnapshot:m,outcome?` | d:stageKey,projectId,activeActorIds | actor+status+sla; instance+enteredAt | WFE; append/history; rapid growth |
| `reviewRequests/{id}` | `taskId*,stageExecutionId*,subjectType*,subjectId*,subjectVersion*,reviewerPolicy:m*,status*,dueAt?,cycle*` | d:reviewerIds,projectId,title | reviewerIds array+status+due; task+cycle | WFE/CMD; retain; AE |
| `approvals/{id}` | `reviewRequestId*,slotKey*,reviewerId*,decision*,decidedAt*,reviewedVersion*,commentId?,delegatedFrom?` | d:taskId,projectId | request+slot; reviewer+decidedAt | CMD append-only; AE; growth moderate |
| `changeRequests/{id}` | `reviewRequestId*,taskId*,requestedBy*,reason*,items:a<m>*,status*,resolvedAt?,resolutionVersion?` | d:assigneeIds | task+status; assignee+status | CMD/WFE; retain; AE |

## 7. Collaboration, Files and Notifications

| Path/entity | fields | indexes/queries | lifecycle/security/migration/risk |
|---|---|---|---|
| `comments/{id}` | `resourceType*,resourceId*,authorId*,body*,status*,visibility:e<internal,client>*,parentCommentId?,editedAt?` | resource+visibility+createdAt؛ author+createdAt | CMD; tombstone؛ AE delete/visibility؛ high growth |
| `mentions/{id}` | `commentId*,mentionedPrincipalId*,status*` | principal+status+createdAt; comment | JOB/CMD parser؛ retain with comment |
| `reactions/{id}` | `commentId*,principalId*,type*,status*` | comment+status؛ unique reservation on triple | CMD؛ S؛ high but small |
| `files/{fileId}` Attachment aggregate | `ownerType*,ownerId*,visibility*,status*,retentionState*,latestVersionId*,displayName*` | owner+status+createdAt; retentionState+date | CMD/JOB; no public URL; AE; from attachment URLs |
| `fileVersions/{id}` | `fileId*,versionNumber*,provider*,objectKey*,checksum*,size*,mimeType*,scanStatus*,status*,uploadedBy*` | file+version desc; scanStatus+status | JOB finalize؛ object immutable؛ AE; high storage not doc size |
| `resourceAttachments/{id}` | `resourceType*,resourceId*,fileId*,visibility*,status*` | resource+visibility+createdAt; fileId | CMD؛ archive; AE |
| `notifications/{id}` | `recipientId*,type*,titleKey*,payloadRef:m*,status*,deliveryState*,readAt?` | recipient+status+createdAt desc | JOB; TTL/archive 90d proposed OD-NOT-01؛ high |
| `notificationPreferences/{id}` | `userId*,eventType*,channels:m*,digest*,quietHours:m?` | user+eventType | CMD; retain membership lifetime; AE admin override |

## 8. Time, HR, Reporting and Intelligence

| Path/entity | fields | indexes/queries | lifecycle/risk |
|---|---|---|---|
| `timeEntries/{id}` | `userId*,taskId?,projectId?,startedAt*,endedAt?,durationMinutes?,status*,billable*,note?` | user+status+startedAt; project+startedAt; task+startedAt | CMD; approved lock؛ HR/financial high volume |
| `timesheets/{id}` | `userId*,periodStart*,periodEnd*,status*,totalMinutes*,submittedAt?,approvedAt?,approverId?` | user+period; team denorm+status+period | CMD/JOB totals; retain policy; AE |
| `attendanceRecords/{id}` | `userId*,workDate*,status*,checkInAt?,checkOutAt?,workedMinutes?,source*,exceptions:a<m>` | user+workDate; department/team denorm+date+status | CMD/JOB; one logical record/user/date; HR |
| `leaveTypes/{id}` | `name*,code*,status*,paid*,unit*,approvalPolicy:m,balancePolicy:m` | status+name | CMD; version/archive; AE |
| `leaveRequests/{id}` | `userId*,leaveTypeId*,startAt*,endAt*,quantity*,status*,reasonCipher?,approverIds:a<r>,decidedAt?` | user+status+start; approverIds+status+start; team denorm+status | CMD/WFE; HR retention; AE |
| `goals/{id}` | `ownerType*,ownerId*,title*,periodStart*,periodEnd*,target:m*,status*,visibility*` | owner+period+status | CMD; retain reporting; AE |
| `kpiDefinitions/{id}` | `key*,name*,definitionVersion*,formula:m*,dataSources:a<s>*,unit*,direction*,status*,visibility*` | key+version; status+name | CMD publish immutable؛ AE |
| `kpiMeasurements/{id}` | `definitionId*,definitionVersion*,subjectType*,subjectId*,periodStart*,periodEnd*,value*,dimensions:m,calculatedAt*,sourceRunId*,status*` | subject+definition+period; definition+period | JOB append؛ export to warehouse; high growth |
| `automations/{id}` | `name*,status*,version*,trigger:m*,conditions:m*,actions:a<m>*,riskLevel*,runAsPolicy:m*` | status+trigger type | CMD publish versioned؛ AE |
| `automationRuns/{id}` | `automationId*,automationVersion*,triggerEventId*,status*,startedAt*,endedAt?,attempts*,idempotencyKey*,actionResults:a<m>` | status+startedAt; automation+startedAt; idempotency unique reservation | JOB; TTL/warehouse after policy; very high |
| `aiRequests/{id}` | `requesterId*,purpose*,modelPolicy*,inputRefs:a<m>*,redactionProfile*,status*,usage:m,costClass*` | requester+createdAt; status+createdAt | JOB; short content retention; AE; sensitive |
| `aiActionProposals/{id}` | `aiRequestId*,actionType*,targetRef:m*,argumentsHash*,riskLevel*,status*,reviewerId?,executedCommandId?` | reviewer+status+createdAt; request | CMD/JOB; retain audit metadata؛ no raw secret |

## 9. Governance, Integrations and Reliability

| Path/entity | fields | indexes/queries | lifecycle/security |
|---|---|---|---|
| `auditEvents/{id}` | `actor:m*,action*,resource:m*,beforeHash?,afterHash?,occurredAt*,correlationId*,outcome*,metadataRedacted:m` | occurredAt desc; action+time; resource.type+resource.id+time; actor.id+time | AUD only؛ append-only؛ long retention/export؛ highest growth |
| `integrations/{id}` | `provider*,type*,status*,scopes:a<s>,credentialRef*,configuredBy*,lastHealthAt?` | provider+status | CMD/JOB؛ secrets in manager only؛ AE |
| `webhooks/{id}` | `integrationId*,direction*,eventTypes:a<s>,endpointRef*,signingSecretRef*,status*,lastDeliveryAt?` | integration+status; eventTypes array+status | CMD/JOB؛ no raw endpoint secret؛ AE |
| `idempotencyRecords/{id}` | `keyHash*,actorId*,commandType*,requestHash*,resourceRef?,status*,responseRef?,expiresAt*` | key direct; expiresAt TTL | CMD only؛ TTL حسب command؛ لا payload raw |
| `domainEvents/{id}` | `eventType*,aggregateRef:m*,aggregateVersion*,payload:m*,occurredAt*,status*,attempts*,correlationId*` | status+occurredAt; eventType+occurredAt; aggregate | transaction outbox؛ JOB dispatch؛ compact/archive |
| `exportJobs/{id}` | `requestedBy*,type*,scope:m*,filtersHash*,status*,fileId?,expiresAt*` | requester+createdAt; status+createdAt | JOB؛ signed download؛ audit |

## 10. Canonical Timestamps

- persistence UTC Firestore `Timestamp`, generated by backend (`FieldValue.serverTimestamp` or server clock in transaction).
- `createdAt` immutable.
- `updatedAt` لكل successful mutation.
- `deletedAt` عند soft delete/pending purge.
- `completedAt` فقط transition إلى completed؛ reopen لا يمحوه، بل يحتفظ completion cycles في events/executions ويحدث current summary.
- domain event `occurredAt` داخل نفس transaction/outbox قدر الإمكان.
- due dates تخزن instant + optional source time zone/calendar policy.
- العرض يستخدم user/organization timezone وlocale؛ لا يخزن localized string.

## 11. Optimistic Concurrency and Idempotency

- كل aggregate command يحمل `expectedVersion`.
- transaction تتحقق ثم تزيد `version`.
- workflow instance يملك `lockVersion`.
- `idempotencyKey` مطلوب للcreate/transition/approval/upload finalize/automation/external callbacks.
- record يربط key بـrequest hash؛ same key + different hash = conflict.
- external side effects تنفذ من outbox/queue، لا داخل Firestore transaction.

## 12. Counters, Aggregates, Pagination and Search

- لا arrays متنامية داخل task/project.
- counters denormalized تحدث عبر idempotent event consumers مع reconciliation job.
- كل list تستخدم cursor (`createdAt/id` أو sort field/id)، page size bounded.
- exact text/prefix المحدود عبر normalized fields؛ البحث العربي/full text ينتقل إلى search service.
- reports الثقيلة وlong-range KPI إلى BigQuery/warehouse؛ Firestore للoperational summaries.

## 13. Index Plan

> أسماء الحقول النهائية تعتمد على implementation، ولا ينشأ index في هذا milestone.

| الشاشة | collection | composite index المقترح |
|---|---|---|
| My Tasks | tasks | `organizationId + activeAssigneeIds(array) + status + dueAt + __name__` |
| Team Tasks | tasks | `organizationId + activeTeamIds(array) + status + dueAt` |
| Project Tasks | tasks | `organizationId + projectId + status + dueAt` |
| Overdue | tasks | `organizationId + status + dueAt` مع statuses نشطة مجزأة إذا لزم |
| Review Queue | reviewRequests | `organizationId + reviewerIds(array) + status + dueAt` |
| Approval Queue | reviewRequests/approvals slots projection | `organizationId + approverIds(array) + status + dueAt` |
| Notifications | notifications | `organizationId + recipientId + status + createdAt(desc)` |
| Attendance | attendanceRecords | `organizationId + teamId/departmentId + workDate(desc) + status` |
| Leave | leaveRequests | `organizationId + approverIds(array) + status + startAt` |
| Time reports | timeEntries | `organizationId + projectId/userId + status + startedAt` |
| Audit | auditEvents | `organizationId + action/resource/actor + occurredAt(desc)` indexes منفصلة |
| Automation runs | automationRuns | `organizationId + automationId/status + startedAt(desc)` |

Firestore لا يدعم array-contains متعددة في query واحدة؛ projections/assignment collection أو search index تستخدم للشاشات المركبة.

## 14. Deletion and Retention

| المورد | السياسة |
|---|---|
| User deactivation | membership disabled، Auth tokens revoked، business records retained |
| Employee departure | employment ended، assignments transferred، portal/session revoked |
| Client/Project/Task | archive أولاً؛ purge بعد references/legal/retention |
| Comment | tombstone يحفظ author/time؛ body purge حسب policy/legal hold |
| File | pending-delete ثم grace، object delete verified، metadata/audit retained |
| Audit | append-only طويل المدى؛ لا tenant delete |
| Notifications/Runs | TTL بعد operational window ثم warehouse/aggregate |
| Legal hold | يتقدم على purge ويظهر في retentionState |

المدد أرقام **Owner decisions OD-RET-01..04**.

## 15. Export, Backup and Recovery

- scheduled Firestore exports لكل environment إلى encrypted bucket منفصل.
- object storage versioning/lifecycle.
- export jobs scoped/redacted ومؤقتة.
- manifest يحوي schema version/counts/checksums.
- quarterly restore rehearsal إلى isolated project.
- deletion requests تعمل عبر inventory وlegal hold وAE.

## 16. أين قد تكون قاعدة علائقية أنسب؟

Firestore مناسب للـrealtime operational work والdocument aggregates. PostgreSQL/Cloud SQL قد يصبح أنسب لـ:

- time/attendance/payroll-grade constraints.
- multi-dimensional reporting وad-hoc joins.
- financial ledgers/budgets.
- complex custom-field filtering.
- strict uniqueness عبر tenant.

القرار المقترح: Firestore أولاً + BigQuery analytics export؛ لا polyglot transactional store قبل قياس الحاجة. إذا أصبحت HR/financial وظائف نظام record قانوني، افصل bounded context علائقي عبر events بدل dual writes غير المنضبط.

