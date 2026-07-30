# مواصفات محرك سير العمل لـZAMAM V2

> **Proposed V2.** مستقلة عن React وFirestore UI. `src/components/TaskCreationModal.tsx` و`EmployeeWorkspace.handleMarkDone` يثبتان مفهوم pipeline في V1، لكن الانتقال الحالي مجرد زيادة `currentStage` ولا يمثل المحرك المقترح.

## 1. المفاهيم

| المفهوم | التعريف |
|---|---|
| Workflow Template | هوية business process مستقرة مثل `seo_article` |
| Draft Workflow | نسخة قابلة للتعديل وغير صالحة لبدء production tasks |
| Published Version | snapshot immutable موقعة بـdefinition hash |
| Archived Version | لا تبدأ instances جديدة، وتظل قابلة للقراءة للتاريخ |
| Stage | حالة عمل ذات actor rule وentry/exit requirements وSLA |
| Transition | edge مسمى من stage إلى أخرى مع conditions وpermission |
| Condition | expression محدودة وآمنة على data موثقة، لا arbitrary code |
| Required Actor | user/team/role/scoped resolver أو client reviewer |
| Required Permission | permission catalog key يعاد فحصها وقت command |
| Required Checklist/File/Field | gate له IDs وvalidation policy |
| Review Stage | ينتج Review Request ودورات changes/resubmit |
| Approval Stage | ينتج slots وقرارات Approval |
| Automated Action | action allowlisted ينفذ عبر automation worker |
| Manual Override | transition استثنائية بإذن وسبب وaudit |
| SLA | مدة عمل أو انتظار حسب calendar policy |
| Escalation | notification/reassignment/manager alert؛ لا يغير القرار تلقائياً إلا policy |
| Rejection/Rework | path صريح مع Change Request ودورة جديدة |
| Cancellation | transition محددة تحفظ السبب ولا تحذف التاريخ |

## 2. تعريف Workflow

كل `WorkflowVersion` يحتوي:

- `stages[]` بمفاتيح ثابتة داخل النسخة.
- `transitions[]` من/إلى مع action keys.
- `startStageId` وterminal stages.
- actor resolvers وsegregation rules.
- requirements schemas.
- SLA calendar/timezone.
- notification/automation bindings.
- compatibility metadata.
- `definitionHash`, `versionNumber`, `publishedAt/by`.

يمنع: stage بلا reachable path، transition إلى نفسها دون cycle policy، terminal بلا معنى، permission مجهولة، أو automated action غير allowlisted.

## 3. Versioning

### 3.1 دورة النشر

1. إنشاء draft جديد كنسخة من published أو فارغ.
2. تعديل واختبار draft فقط.
3. static validation: graph، permissions، actors، forms، cycles، terminal paths.
4. simulation على fixtures ودry-run transitions.
5. review وموافقة `workflow.publish`.
6. نشر immutable version وتحديث `currentPublishedVersionId`.
7. tasks الجديدة ترتبط بهذه النسخة؛ القديمة لا تتغير.

### 3.2 Active task migration

- ليست تلقائية.
- migration plan يحدد source/target، stage mapping، field mapping، dropped requirements، compensations.
- preview يحصي compatible/blocked tasks.
- كل instance تنتقل transactionally مع expected version وAE.
- لا migration إذا approval مفتوح أو upload processing إلا policy صريحة.
- failure يترك instance على source version.

### 3.3 Rollback

لا "تعديل" published version. rollback يعني نشر version جديدة من definition سابقة. active instances لا ترجع إلا migration منفصلة.

### 3.4 Compatibility

- Add optional field/notification: compatible.
- تغيير label فقط: compatible.
- required field/checklist/actor/transition: breaking.
- حذف stage أو تغيير semantics: breaking.
- change permission: security-breaking ويحتاج review.

## 4. Transition Engine

### 4.1 Command

`TransitionTaskCommand` يحمل:

`organizationId, taskId, workflowInstanceId, expectedInstanceVersion, actionKey, actorContext, input, attachmentIds, checklistEvidence, approvalRef?, idempotencyKey, correlationId`.

client لا يرسل role effective أو target stage موثوقاً؛ engine يحله من published version.

### 4.2 التحقق بالترتيب

1. Authentication/session active.
2. organization membership وtenant match.
3. task/instance exists وغير terminal إلا transition مسموحة.
4. `workflowVersionId` منشورة ومثبتة.
5. `expectedInstanceVersion` يطابق الحالي.
6. transition من `currentStageId` وبـ`actionKey` موجودة.
7. actor resolver يطابق assignment/delegation/client membership.
8. permission وresource scope.
9. segregation/conflict-of-interest.
10. required fields typed ومحدودة.
11. required checklist مكتملة ولم تتغير.
12. attachments available، clean، owned، visibility مناسبة.
13. review/approval result يطابق `subjectVersion`.
14. transition conditions صحيحة.
15. idempotency key غير مستخدم لpayload مختلف.
16. transaction: close execution، create next execution، update instance/task/version، outbox/audit.

### 4.3 نتيجة موحدة

- نجاح: effective stage/status، new version، emitted event IDs، warnings.
- conflict: `VERSION_CONFLICT` مع snapshot summary آمن.
- gate failure: codes مثل `CHECKLIST_INCOMPLETE`, `APPROVAL_REQUIRED`.
- deny: `FORBIDDEN` دون كشف resource غير المرئي.
- retryable infrastructure error لا يكرر side effects بفضل idempotency.

### 4.4 Audit

كل محاولة حساسة تسجل actor، action، source/target، workflow version، task version، outcome، reason، correlation/idempotency، requirements hash. لا يسجل file content أو comments الحساسة كاملة.

## 5. Actor Resolution

| Rule | السلوك |
|---|---|
| `explicit_user` | assignment active للمستخدم |
| `team_member` | user active في team وبpermission |
| `role_in_scope` | role assignment مطابق resource scope |
| `task_owner` | owner الحالي |
| `project_role` | Project Member بدور محدد |
| `manager_of_assignee` | يحل من Employment snapshot |
| `client_contact` | portal user لنفس client/project |
| `automation` | service principal allowlisted |

`role_in_scope` لا يعني أن أي مستخدم يلتقط العمل افتراضياً؛ claim policy **OD-TSK-02** تحدد ذلك، والclaim atomic.

## 6. Approval Policies

| النمط | اكتمال القرار | قواعد |
|---|---|---|
| Single reviewer | قرار reviewer واحد | reviewer محدد/محلول |
| Any-one | أول approval/rejection effective حسب policy | يمنع السباق transactionally |
| All reviewers | كل slots approved | rejection قد ينهي فوراً حسب policy |
| Ordered | slot N بعد N-1 | لا skip |
| Team leader | قائد team وقت الطلب snapshot | delegation مدقق |
| Department manager | manager للقسم scope | fallback owner required |
| Client approval | contact مخول لنفس project | client-visible version فقط |
| Conditional | policy يختار reviewers حسب value/risk | condition versioned |

القرارات: `approve`, `reject`, `request_changes`, `delegate`.  
كل قرار يثبت reviewer، authority snapshot، time، subject version/hash، comment/evidence، decision slot.

### Expiration and delegation

- dueAt من SLA/calendar.
- expiration لا تعني approval؛ تنتقل `expired` وتصعد.
- delegation time-boxed ولشخص مؤهل، مع الأصل والمفوض.
- reviewer لا يغير قراره؛ correction creates superseding decision بإذن خاص.

### Request changes/resubmit

ينشأ `ChangeRequest` وstage execution جديدة أو عودة محددة. resubmit يزيد `cycle` ويخلق Review Request جديدة على subject version جديدة. **OD-WFL-02** يحسم هل rework يعود لنفس stage أو stage محددة لكل template.

## 7. SLA and Escalation

- SLA يحسب business minutes وفق organization/project calendar.
- waiting on client/approved leave/system outage يمكن pause حسب reason codes.
- reminders عند نسب configurable.
- breach ينتج `task.sla_breached` ولا يغير owner بصمت.
- escalation levels: assignee -> leader -> department manager -> operations.
- override/reassignment action مستقل permissioned.

## 8. Workflow Example: SEO Article

| Stage | actor | Entry | Exit/files/checklist | SLA | approval/rework |
|---|---|---|---|---:|---|
| Brief | Project Manager | project/client active، brief owner | audience, goal, word count, due date؛ brief attachment optional | 4h | missing info -> blocked/client request |
| Keyword Research | SEO Specialist | brief complete | keyword sheet، intent، primary/secondary terms checklist | 8h | internal self-check |
| Writing | Writer | research approved | draft version، sources، plagiarism/claims checklist | 16h | -> SEO Review |
| SEO Review | Reviewer غير الكاتب | draft clean | score/evidence، decision | 8h | changes -> Writing؛ approve -> Client Review |
| Client Review | authorized Client | client-visible draft | client decision/comment | 2 business days | changes -> Writing أو SEO Review حسب change type |
| Upload | Publisher | client approved version | CMS preview URL/screenshot، metadata checklist | 4h | failure -> Upload blocked |
| Final Approval | Project Manager | preview موجود | compare approved version، release decision | 4h | changes -> Upload؛ reject -> SEO Review |
| Completed | system | final approval | completedAt، delivery notification | terminal | reopen permission only |

Notifications: assignment، 50/80% SLA، review requested، client reminder، approval/completion.  
Automations: create checklists، copy approved metadata، schedule reminders، KPI events. لا CMS publish تلقائي في أول release.

## 9. Workflow Example: Graphic Design

| Stage | actor | Entry | Exit/files/checklist | SLA | approval/rework |
|---|---|---|---|---:|---|
| Request | Account/PM | client/project active | dimensions, channels, copy, brand refs | 4h | incomplete -> requester |
| Design | Designer | request locked | source preview v1، fonts/license checklist | 16h | -> Internal Review |
| Internal Review | Team Leader/Art Director | clean preview | brand, spelling, dimensions decision | 8h | changes -> Design |
| Client Review | Client approver | internal approved version | approve/request changes | 2 days | changes -> Design new cycle |
| Changes | Designer | Change Request open | addressed items/evidence/new version | 8h | -> Internal Review أو Client Review حسب policy |
| Final Export | Designer/Publisher | approved design version | source + exports + checksum، naming checklist | 4h | mismatch -> Design |
| Delivered | PM/system | exports clean | delivery receipt/client notification | terminal | reopen controlled |

Automations: generate folders privately، naming validation، reminders، delivery package.  
Owner decisions: هل كل client change يعيد internal review `OD-WFL-03`.

## 10. Workflow Example: Social Media Campaign

| Stage | actor | Entry | Exit/files/checklist | SLA | approval/rework |
|---|---|---|---|---:|---|
| Planning | Strategist | client brief | goals, channels, calendar, KPI targets | 2 days | PM approval |
| Content | Copy Team | plan approved | copy matrix، hashtags، claims check | 2 days | -> Design |
| Design | Design Team | copy version fixed | assets لكل channel | 3 days | internal combined review |
| Internal Approval | Team Lead + PM (all) | content/design package | approve package version | 1 day | changes -> Content/Design by item |
| Client Approval | client any-one أو ordered OD-WFL-04 | internal approval | explicit package decision | 2 days | changes route by component |
| Scheduling | Publisher | approved package | schedule IDs/screenshots، timezone checklist | 1 day | errors -> Scheduling |
| Reporting | Analyst | campaign period ended | metrics snapshot، notes، report | 2 days | PM review ثم complete |

Notifications: package ready، client reminders، scheduled/failed items، reporting due.  
Automations: generate child tasks per post، due dates، scheduled reminders، ingest metrics عبر integration لاحقاً.

## 11. Workflow Example: Website Development

| Stage | actor | Entry | Exit/files/checklist | SLA | approval/rework |
|---|---|---|---|---:|---|
| Discovery | PM/BA | project active | requirements، acceptance criteria، risks | 3 days | client confirms scope |
| Design | UX/UI | discovery approved | design version/prototype، accessibility checklist | milestone | internal then client review |
| Development | Developers | approved design/scope | code refs، build artifact، technical checklist | milestone | PR review منفصل |
| QA | QA غير المنفذ عند الإمكان | deploy to staging | test run، defects، security/accessibility evidence | 3 days | defects -> Development |
| Client Review | client approver | QA pass/staging | UAT decision/version | 3 days | changes -> triage ثم Design/Dev |
| Deployment Approval | PM + authorized technical approver (all) | UAT approved، rollback plan | release approval/change window | 1 day | reject -> QA/Dev |
| Release | automation + operator | approval valid | deployment result، health checks، release notes | window | failure -> rollback transition |

Automations: create environment checklist، QA reminders، release freeze، health-check job، incident on failure.  
لا deployment credential يصل للclient أو task document؛ Integration service يستخدم secret manager.

## 12. Manual Override

مسموح فقط إذا:

- `task.override_transition`.
- target transition معرفة `isOverride=true`.
- reason code + text.
- impact preview.
- step-up للhigh-risk.
- notifications للowner/reviewer.
- AE لا يمكن حذفه.

لا override لـtenant boundary، file quarantine، أو approval evidence integrity.

## 13. Current-to-V2 Notes

- `pipeline[]` الحالية تتحول إلى draft template candidate فقط، لا published workflow تلقائياً.
- `currentStage` map يحتاج validation؛ stage statuses الحالية غير موثوقة.
- `requiresAdminApproval` يصبح approval stage/policy بعد **OD-WFL-01**، لا boolean runtime.
- tasks بلا history تحصل على synthetic migration event واضح، لا history مخترعة.

