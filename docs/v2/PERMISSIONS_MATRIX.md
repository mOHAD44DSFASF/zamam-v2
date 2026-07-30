# نظام الصلاحيات لـZAMAM V2

> **حالة التنفيذ (P5):** catalog والـ scoped deny-by-default engine والخدمة الموثوقة منفذة في `packages/authorization` و`services/functions/src/authorization`. راجع `AUTHORIZATION_IMPLEMENTATION.md`. التخزين الدائم يبدأ في P6.

> **Proposed V2.** النموذج يجمع RBAC مع scopes وخصائص المورد. إخفاء UI ليس authorization، وكل privileged command يعاد تقييمه في trusted backend.

## 1. نموذج التفويض

### 1.1 المكونات

- `Permission`: فعل namespaced ثابت في catalog.
- `Role`: مجموعة permissions قابلة للتخصيص داخل المنظمة.
- `RoleAssignment`: role لمستخدم على scope محدد.
- `Scope`: `organization | department | team | project | workspace | self | client_account`.
- `Ownership`: قواعد إضافية مثل task assignee أو comment author.
- `Explicit restriction`: deny مبرر ومؤقت/دائم؛ deny يتقدم على grant.
- `Business-state guard`: يمنع الفعل حتى مع permission، مثل تعديل task مكتملة.

### 1.2 الأدوار الافتراضية

`Owner`, `GeneralManager`, `DeputyManager`, `DepartmentManager`, `TeamLeader`, `Supervisor`, `Employee`, `Contractor`, `Client`, `SystemAdministrator`.

المنظمة تستطيع إنشاء custom roles، لكن لا يمكنها اختراع permission keys أو تجاوز tenant boundary/system invariants.

## 2. Permission Catalog

### Organization and security

| Permission | المعنى | الحساسية |
|---|---|---|
| `organization.view` | عرض بيانات المنظمة الأساسية | Low |
| `organization.manage` | تعديل الهوية والسياسات غير الأمنية | High |
| `organization.suspend` | تعليق tenant | Critical، platform only |
| `settings.view` | عرض settings المسموحة | Medium |
| `settings.manage` | تعديل settings عامة | High |
| `security.policy.view` | عرض security policy | High |
| `security.policy.manage` | تعديل MFA/session/retention security | Critical |
| `audit.view` | عرض audit ضمن scope | High |
| `audit.export` | تصدير audit | Critical |
| `support.access.grant` | منح JIT support access | Critical |

### Structure and people

| Permission | المعنى |
|---|---|
| `department.view/create/manage/archive` | قراءة/إنشاء/تعديل/أرشفة الأقسام |
| `team.view/create/manage/archive` | عمليات الفرق |
| `user.view/invite/update/disable/restore` | lifecycle للحساب |
| `employment.view/manage/compensation.view` | الملف الوظيفي؛ التعويض منفصل |
| `role.view/manage/assign` | catalog والأدوار والإسناد |
| `membership.view/manage` | عضويات المنظمة والنطاق |
| `work_schedule.view/manage` | جداول العمل |

### Clients and projects

| Permission | المعنى |
|---|---|
| `client.view/create/manage/archive` | حسابات العملاء |
| `client.contact.manage` | اتصالات العميل والبوابة |
| `client.financial.view` | بيانات مالية للعميل |
| `project.view/create/manage/archive/reopen` | lifecycle للمشروع |
| `project.member.manage` | عضويات ورؤية المشروع |
| `project.financial.view/manage` | budget/rates |
| `workspace.view/create/manage/archive` | مساحات العمل |
| `workspace.member.manage` | عضويات workspace |

### Tasks and workflow

| Permission | المعنى |
|---|---|
| `task.view` | عرض task داخل scope وvisibility |
| `task.view_all` | عرض كل tasks داخل scope، لا يلغي client/internal |
| `task.create/update/archive/delete` | CRUD؛ delete يعني request purge لا hard delete مباشر |
| `task.assign/reassign/claim` | assignment operations |
| `task.transition` | transition عادي يطابق workflow |
| `task.override_transition` | manual override مع reason |
| `task.reopen` | إعادة completed task |
| `task.approve` | approval decision |
| `task.bulk_manage` | bulk changes المسموحة |
| `subtask.manage` | subtasks |
| `checklist.update/override` | إكمال/تجاوز checklist |
| `workflow.view/create/manage/publish/archive/migrate_instances` | workflow lifecycle |
| `review.request/perform/cancel` | review lifecycle |
| `approval.delegate` | تفويض approval |
| `change_request.create/resolve` | rework |

### Collaboration and files

| Permission | المعنى |
|---|---|
| `comment.internal.view/create/update/delete` | internal comments |
| `comment.client.view/create/update/delete` | client-visible comments |
| `mention.create` | mentions ضمن visibility |
| `file.view/upload/download/version/delete/restore` | file lifecycle |
| `file.internal.view` | internal-only files |
| `file.client.share` | نشر file للعميل |
| `tag.view/manage` | tags |
| `saved_view.create/share/manage` | saved views |
| `custom_field.view/manage` | custom field definitions/values |

### Time, HR and performance

| Permission | المعنى |
|---|---|
| `time.track/view_self/view_team/adjust` | time entries |
| `timesheet.submit/approve/unlock` | timesheets |
| `workload.view_self/view_team/view_organization/manage` | capacity/workload |
| `attendance.view_self/view_team/record/manage` | attendance |
| `leave.view_self/request/view_team/approve/manage` | leave |
| `goal.view/manage` | goals |
| `kpi.view_self/view_team/view_organization/manage` | KPI |
| `report.view_self/view_team/view_department/view_organization` | reports |
| `report.export` | export scoped report |
| `performance.sensitive.view` | detailed employee metrics |

### Automation, AI, integration

| Permission | المعنى |
|---|---|
| `notification.view/manage_preferences/admin_retry` | inbox/preferences/retry |
| `automation.view/create/manage/publish/execute/cancel` | automation lifecycle |
| `ai.use` | إنشاء AI request |
| `ai.view_history` | history ضمن scope |
| `ai.action.approve` | اعتماد proposal مع target permission أيضاً |
| `ai.policy.manage` | models/redaction/risk |
| `integration.view/manage/credential.rotate` | connectors |
| `webhook.view/manage/replay` | webhooks |
| `search.use/admin` | search/query indexing |

### Platform control plane

| Permission | المعنى |
|---|---|
| `platform.health.view` | telemetry غير المحتوى |
| `platform.tenant.provision` | إنشاء tenant |
| `platform.tenant.support` | بدء JIT session |
| `platform.incident.manage` | incidents |

أي key غير موجودة في catalog = deny.

## 3. Permission Bundles

| Bundle | Permissions |
|---|---|
| `BASIC_MEMBER` | organization.view، user.view المحدود، team.view، project.view/task.view حسب membership، comment/file permissions حسب visibility، notification، saved view |
| `SELF_SERVICE` | user profile self، time.track/view_self، timesheet.submit، attendance.view_self/record، leave.view_self/request، workload.view_self، report.view_self |
| `TASK_EXECUTOR` | task.update المحدود، task.transition، task.claim إذا policy، checklist.update، file.upload/download، comment.internal.create |
| `TEAM_OPERATIONS` | team.view/manage، membership.view، task.view_all/create/assign/reassign، review.perform، workload/report/time/attendance/leave team views |
| `DEPARTMENT_OPERATIONS` | department/team management، project/task/workflow operations ضمن القسم، department reports |
| `PROJECT_MANAGER` | client.view، project.manage/member.manage، workspace/manage، task lifecycle، reviews/approvals، project reports |
| `ORG_OPERATIONS` | كل operational permissions organization scope باستثناء security/role/audit export/financial حسب قرار |
| `ORG_GOVERNANCE` | settings/security/role/audit/retention/integration العالية |
| `CLIENT_PORTAL` | client/project/task/file/comment client-visible فقط ضمن client account |
| `PLATFORM_ADMIN` | platform.* فقط؛ لا tenant business permissions افتراضياً |

## 4. Default Role Matrix

| Role | Default bundles/permissions | Scope | قيود صريحة ورؤية البيانات |
|---|---|---|---|
| Owner | `ORG_OPERATIONS + ORG_GOVERNANCE`، financial، audit export، support grant | organization | لا يتجاوز platform؛ critical actions step-up/MFA |
| GeneralManager | `ORG_OPERATIONS`، org reports، performance sensitive؛ financial حسب OD-FIN-01 | organization | لا security policy/Owner lifecycle افتراضياً |
| DeputyManager | grants مفوضة من GM/Owner | organization أو موارد مسماة | delegation لها start/end؛ لا توريث تلقائي لكل governance |
| DepartmentManager | `DEPARTMENT_OPERATIONS + PROJECT_MANAGER` | department وكل descendants المسموحة | لا يرى departments أخرى أو compensation |
| TeamLeader | `BASIC_MEMBER + SELF_SERVICE + TASK_EXECUTOR + TEAM_OPERATIONS` | team | لا role/user disable؛ approvals حسب workflow |
| Supervisor | Basic + task/review/project permissions | project/workspace assignments | لا إدارة team العامة؛ لا reports خارج resource |
| Employee | `BASIC_MEMBER + SELF_SERVICE + TASK_EXECUTOR` | self + explicit assignments + team shared visibility | لا view_all؛ لا reassign خارج policy |
| Contractor | subset من Employee | explicit project/task، bounded time | لا directory/HR/internal client data غير اللازمة؛ expiry إلزامي |
| Client | `CLIENT_PORTAL` | client_account + explicit projects | لا internal comments/files، لا employee performance/attendance |
| SystemAdministrator | `PLATFORM_ADMIN` | control plane | لا tenant content؛ JIT access منفصل بموافقة وAE |

## 5. Visibility Matrix

| Role | Financial | Employee performance | Audit | Client data | Internal operations |
|---|---|---|---|---|---|
| Owner | نعم | organization | كامل tenant | كامل tenant | كامل tenant |
| GM | OD-FIN-01 | organization | operational audit read | كامل tenant | كامل tenant |
| Deputy | explicit grant | delegated scope | delegated scope | delegated scope | delegated scope |
| Department Manager | لا افتراضياً | department | sensitive actions داخل scope فقط | projects داخل scope | department |
| Team Leader | لا | team summary/individual حسب OD-MET-02 | لا raw audit؛ activity فقط | project-limited | team |
| Supervisor | لا | resource delivery metrics | activity only | assigned resources | assigned resources |
| Employee | لا | self | own activity | task-required minimum | own/shared tasks |
| Contractor | لا | self فقط إن لزم | own activity | explicit minimum | explicit tasks |
| Client | لا internal؛ client commercial حسب OD-CLI-02 | أبداً | client-visible activity only | own client | لا |
| SysAdmin | لا | لا | platform audit؛ tenant JIT only | لا | لا |

## 6. Resource-scoped Rules

- organization grant يشمل children إلا explicit deny.
- department scope يشمل teams/projects الموسومة بالقسم، لا projects cross-department إلا assignment.
- team scope يشمل team-owned resources، لا كل موارد أعضائه.
- project/workspace membership يعطي `view` فقط حسب membership visibility؛ actions تحتاج permission.
- ownership لا يمنح تلقائياً delete/approve.
- task assignee يستطيع التنفيذ والtransition المسموح، لا تغيير workflow أو visibility.
- reviewer لا يعتمد عمله بنفسه إذا segregation policy مفعلة.
- client scope يطبق `visibility=client` و`clientId` معاً.
- support access لا يندمج مع role tenant؛ session منفصلة time-boxed.

## 7. Authorization Decision Algorithm

1. تحقق من authenticated identity وtoken freshness/step-up.
2. تحقق من active organization membership.
3. تحقق أن account وemployment ليسا disabled/ended بما يمنع الفعل؛ revoke sessions فور disable.
4. حمّل active Role Assignments من مصدر موثوق، لا من request.
5. حل scope hierarchy والوقت/delegation.
6. طبق explicit denies ثم grants؛ deny يتقدم.
7. تحقق أن resource `organizationId` يطابق المنظمة والسياق.
8. طبق resource membership/ownership/visibility/client boundary.
9. طبق business-state restrictions وsegregation وrequired fields.
10. نفذ command transactionally وسجل sensitive action في Audit Event بالنتيجة.

القرار يجب أن ينتج `allow/deny`, `reasonCode`, `policyVersion`, `effectiveScope`; لا تعرض التفاصيل الأمنية الكاملة للclient.

## 8. Sensitive Operation Requirements

| العملية | permission | شروط إضافية |
|---|---|---|
| دعوة/تعطيل مستخدم | `user.invite` / `user.disable` | backend Admin SDK، لا self-disable owner الأخير، AE، token revoke |
| تغيير role | `role.assign` | actor لا يمنح ما لا يملكه؛ scope validation؛ AE |
| تغيير security policy | `security.policy.manage` | MFA/step-up، two-person approval حسب OD-SEC-02 |
| حذف/إعادة فتح task | `task.delete` / `task.reopen` | retention/reference/reason/version |
| override workflow | `task.override_transition` | reason، target allowed override، notify/audit |
| approval | `task.approve` | reviewer slot، reviewed version، no conflict-of-interest |
| client share | `file.client.share` | scan=clean، project/client match |
| report/export | matching report permission + `report.export` | field-level redaction، async export، expiry |
| attendance/time correction | manage/adjust permission | reason، old/new audit |
| automation publish | `automation.publish` | validation، risk owner، dry run |
| AI execute | `ai.action.approve` + target action permission | arguments hash unchanged، policy/risk |
| integration credential rotate | `integration.credential.rotate` | secret manager، no value in DB/log |
| audit export | `audit.export` | step-up، watermark/expiry، AE |

## 9. Security Rules

- UI hiding is not authorization.
- frontend role strings/route params/client claims غير موثوقة.
- privileged writes تمر بالbackend.
- unknown permission/scope/status = deny.
- cross-organization access denied دائماً، حتى SystemAdministrator بدون JIT.
- client users لا يصلون إلى internal comments/files/metrics.
- disabled users: revoke tokens، rules/backend membership check، listener/session termination.
- permission changes وdenials الحساسة audited.
- Firestore rules تكون دفاعاً إضافياً وتسمح فقط بالقراءات المحددة والـlow-risk writes؛ business commands لا تكتب مباشرة.

## 10. Legacy Role Mapping

| V1 role | Confirmed V1 | V2 mapping المقترح | uncertainty |
|---|---|---|---|
| `Admin` | route إلى Admin وfull UI غالباً | migration preview إلى `GeneralManager` فقط؛ لا `Owner` | حُسم في Master Goal؛ أول Owner عبر secure bootstrap |
| `DeputyManager` | full workspaces/tasks تقريباً | `DeputyManager` بعد حل scope ومدة delegation | لا grants قبل resolution |
| `Manager` | UI إدارة مقيد ومساحات يشرف عليها | quarantine حتى تحديد `DepartmentManager`, `TeamLeader` أو `Supervisor` scoped | حُسم منع privilege الافتراضي |
| `Reviewer` | pipeline actor label | permission set `review.perform`, لا يلزم system role | نطاقه غير مؤكد |
| `Uploader` | pipeline actor | custom operational role + file permissions | هل يرى client delivery؟ **OD-ROL-03** |
| `Creator` | default employee/pipeline actor | `Employee` + task executor | الاسم التجاري الدقيق غير مؤكد |
| dynamic role | Firestore role doc | custom Role؛ migrate name + inferred permissions بعد owner review | لا يمكن استنتاج permissions من الاسم |

لا migration تمنح V2 permissions تلقائياً بناءً على النص وحده. كل mapping ينتج review report وexplicit approval.
