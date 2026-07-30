# بنية المعلومات وتجربة الاستخدام لـZAMAM V2

> **Proposed V2.** لا React components في هذا milestone. Arabic RTL هو default. كل route يعرض فقط ما تسمح به policy server-side؛ navigation filtering تحسين UX وليس authorization.

## 1. Application Shells

### 1.1 Internal shell

Base: `/o/:organizationSlug`

Navigation حسب permission:

1. Home
2. My Work
3. Inbox
4. Approvals
5. Projects
6. Clients
7. Teams
8. Calendar
9. Workload
10. Time
11. Reports
12. Automations
13. Files
14. Administration
15. Settings

Organization switcher يظهر فقط للعضويات النشطة. URL يستخدم slug للراحة؛ backend يحل `organizationId` ولا يثق بالslug.

### 1.2 Client portal shell

Base: `/portal/:organizationSlug`

Dashboard، Projects، Requests، Approvals، Deliveries، Notifications، Profile. لا links أو shared components تعرض internal data.

### 1.3 Authentication shell

`/auth/login`, `/auth/reset-password`, `/auth/invitations/:token`. Token لا يسجل في analytics/logs، ويستبدل بعد الاستخدام.

## 2. Screen State Contract

كل شاشة في الجدول تطبق:

- **Loading:** skeleton يحافظ على layout؛ لا spinner كامل بلا context.
- **Empty:** يشرح السبب والـnext allowed action، ولا يقترح فعلاً غير مصرح.
- **Error:** safe Arabic message + retry/correlation ID؛ 403 و404 لا يكشفان existence.
- **Mobile:** primary action ثابت/واضح؛ tables تتحول list أو horizontal data view؛ لا critical hover-only.
- **Accessibility:** page title/H1 واحد، landmarks، keyboard order، labels، focus restore، live regions، reduced motion، WCAG 2.2 AA.
- **Sensitive action:** confirmation يذكر الأثر، typed name/step-up عند high risk، لا optimistic update.
- **Audit:** create/update/delete/transition/permission/export/approval/file share/HR correction تسجل؛ pure views لا تسجل إلا sensitive export/access policy.

في جدول الشاشات: `E/L/R` يذكر empty/loading/recovery الخاص فوق العقد المشترك.

## 3. Main Screens

### Authentication and Home

| Route / Screen | الغرض والمستخدمون | البيانات/actions/filters | E/L/R، mobile، sensitive/audit |
|---|---|---|---|
| `/auth/login` Login | كل غير مسجل | email/password، SSO لاحقاً، organization hint غير موثوق | rate-limit/lock feedback؛ mobile single column؛ login security log |
| `/auth/reset-password` Password Reset | account user | request/reset token، password rules | generic success يمنع enumeration؛ step token hidden |
| `/auth/invitations/:token` Invitation Acceptance | invited user | invite summary بعد token verify، profile/password/consent | expired/used states + resend path؛ AE accept/decline |
| `/o/:slug/home` Dashboard | كل member؛ widgets scoped | My priorities، due، blockers، approvals، workload summary حسب permission؛ period/team filters | empty onboarding؛ widget partial errors؛ no fabricated zero؛ exports audited |
| `/o/:slug/inbox` Inbox | members | assignments، mentions، review/approval requests، system alerts؛ type/status/date | empty "لا عناصر"؛ bulk read low-risk؛ deep links keyboard |
| `/o/:slug/notifications` Notifications | members | notification list، read/archive، preferences link | cursor pagination؛ failed delivery لا يكشف provider detail |

### Work and Task Views

| Route / Screen | الغرض والمستخدمون | البيانات/actions/filters | E/L/R، mobile، sensitive/audit |
|---|---|---|---|
| `/my-work` My Tasks | employee/contractor/manager | assigned/owned/watched tasks؛ transition/quick time؛ status/due/project/priority | grouped overdue/today/upcoming؛ mobile cards؛ transition AE |
| `/tasks` List View | scoped task viewers | columns، bulk actions، saved views؛ project/team/assignee/status/tag/custom fields | virtual/paginated rows؛ URL filters؛ bulk confirmation/AE |
| `/tasks/board` Kanban View | scoped viewers | columns by status/stage؛ drag transition | rejected drag snaps back with reason؛ touch alternative؛ transition AE |
| `/tasks/calendar` Calendar View | scoped viewers | start/due tasks؛ project/team/status | agenda fallback mobile؛ timezone visible؛ date change permission/AE |
| `/tasks/timeline` Timeline View | project managers | dependencies/milestones/date ranges | horizontal + accessible table alternative؛ schedule edits AE |
| `/tasks/new` Task Create/Edit (create mode) | `task.create` | project/workspace، title، owner، assignments، dates، workflow، fields | draft recovery؛ server validation؛ create AE |
| `/tasks/:taskId/edit` Task Create/Edit (edit mode) | `task.update` in state | editable fields حسب state/version | conflict diff/reload؛ no completed silent edit؛ AE |
| `/tasks/:taskId` Task Details | resource viewers | tabs أدناه؛ commands حسب permission | 404/403 safe؛ mobile tab menu؛ كل sensitive mutations AE |

### Review and Approval

| Route / Screen | الغرض والمستخدمون | البيانات/actions/filters | E/L/R، mobile، sensitive/audit |
|---|---|---|---|
| `/reviews` Review Inbox | reviewers | requests، subject version، SLA، compare، changes/approve/reject | empty scoped؛ stale version conflict؛ decisions non-optimistic + AE |
| `/approvals` Approval Inbox | approvers | slots/policy/order/delegation/client/internal | unavailable predecessor state؛ mobile decision sheet؛ step-up high-risk |
| `/reviews/:id` Review Detail | reviewer/requester read | version diff، checklist، files، history | quarantined file state؛ decision requires comment by policy؛ AE |

### Clients and Projects

| Route / Screen | الغرض والمستخدمون | البيانات/actions/filters | E/L/R، mobile، sensitive/audit |
|---|---|---|---|
| `/clients` Client List | `client.view` | clients، health، owner، active projects؛ status/owner/search | empty create CTA if allowed؛ PII-minimized |
| `/clients/:clientId` Client Details | scoped users | overview، contacts، projects، activity، portal access | archived banner؛ portal invite/revoke AE |
| `/projects` Project List | members/managers | list/cards، owner/client/status/due؛ saved views | cursor pagination؛ financial columns permissioned |
| `/projects/:projectId` Project Details shell | project members | subnav + header lifecycle actions | no membership=no reveal؛ archive/reopen AE |
| `/projects/:id/overview` Project Overview | members/client variant | health، milestones، team، risks، client summary | missing metrics labeled unavailable |
| `/projects/:id/tasks` Project Tasks | project members | list/board toggle، create/bulk | preserves URL filters؛ actions scoped |
| `/projects/:id/files` Project Files | project/file viewers | folders/metadata/versions/share | scan/quarantine states؛ download/share/delete AE |
| `/projects/:id/activity` Project Activity | members/client projection | domain activity timeline؛ actor/type/date | internal events filtered server-side؛ paginated |

### Organization and People

| Route / Screen | الغرض والمستخدمون | البيانات/actions/filters | E/L/R، mobile، sensitive/audit |
|---|---|---|---|
| `/departments` Department List | department viewers/managers | hierarchy، managers، teams، capacity | empty setup CTA؛ archive reference preview/AE |
| `/teams/:teamId` Team Details | team members/managers | members، work، workload، schedule summary | departed members distinguished؛ membership AE |
| `/people` Employee Directory | `user.view` | safe profile fields؛ department/team/status/search | PII field projection؛ no compensation by default |
| `/people/:userId` Employee Profile | self/scoped managers/HR | profile، employment، teams، work summary، time/leave tabs permissioned | field-level 403؛ HR changes/reports AE |
| `/workload` Workload | self/team/org permissions | capacity vs allocation، date/team/project | no capacity = unknown not 0؛ drag assignment AE |

### Time, Attendance, Leave and Reports

| Route / Screen | الغرض والمستخدمون | البيانات/actions/filters | E/L/R، mobile، sensitive/audit |
|---|---|---|---|
| `/time` Time Tracking | members | running timer، entries، task/project؛ date/status | offline conflict explanation؛ timer stop Idem/AE |
| `/timesheets` Timesheets | employees/managers | periods، submit/approve/reject؛ user/team/status | locked state clear؛ decisions AE |
| `/attendance` Attendance | self/managers/HR | daily records/exceptions؛ date/team/status | privacy projection؛ correction reason/AE |
| `/leave` Leave Requests | employees/managers/HR | balances، request، approve؛ type/status/date | overlap/balance errors؛ private reason protected؛ AE |
| `/reports` Reports | scoped managers | catalog، filters، KPI definitions، async export | no-data vs unavailable؛ export job/expiry/AE |
| `/reports/:reportKey` Report Detail | permission per report | chart/table/drilldown، saved filter/export | accessible data table؛ definition/version visible |

### Workflow, Automation, Files and Administration

| Route / Screen | الغرض والمستخدمون | البيانات/actions/filters | E/L/R، mobile، sensitive/audit |
|---|---|---|---|
| `/admin/workflows` Workflow Templates | workflow viewers/managers | templates، versions، usage/status | no delete if referenced؛ publish/archive AE |
| `/admin/workflows/:id/builder` Workflow Builder | `workflow.manage` | graph/stages/transitions/forms/SLA/actors، validate/simulate | desktop primary؛ mobile read-only summary؛ unsaved draft recovery |
| `/automations` Automation Builder/List | automation admins | rules، status، trigger/action، risk، dry run | invalid rule diagnostics؛ publish/pause AE |
| `/automations/runs` Automation Runs | admins/operators | status، attempts، actions، correlation؛ filters | DLQ/replay controlled + AE |
| `/files` File Library | authorized users | owned/shared files، versions، retention، search | no orphan broad view؛ download/share/delete audited |
| `/admin/roles` Role Management | role viewers/managers | custom roles، permission bundles، usage | prevent privilege escalation/last Owner; changes AE |
| `/admin/permissions` Permission Management | Owner/security admin | assignments، scopes، grants/denies، simulator | impact preview؛ MFA/step-up؛ all AE |
| `/settings/organization` Organization Settings | Owner/settings admin | locale/timezone/features/retention | category errors isolated؛ settings changes AE |
| `/settings/integrations` Integration Settings | integration admins | provider health/scopes/connect/revoke/rotate | secrets never shown؛ OAuth state; AE |
| `/admin/audit` Audit Log | auditors | actor/action/resource/outcome/time/correlation؛ export | immutable/no edit؛ cursor؛ export step-up/AE |

### Client Portal

| Route / Screen | الغرض والمستخدمون | البيانات/actions/filters | E/L/R، mobile، sensitive/audit |
|---|---|---|---|
| `/portal/:slug` Client Portal Dashboard | active client contacts | allowed projects، pending approvals، deliveries، requests | internal widgets absent server-side؛ mobile-first |
| `/portal/:slug/projects/:id` Client Project View | project-authorized client | client-visible overview/tasks/milestones/activity/comments | employee names حسب OD-CLI-01؛ access/exports policy |
| `/portal/:slug/approvals/:id` Client Approval View | designated approver | exact reviewed version/files، decision/change request | expired/stale version explicit؛ decision AE |
| `/portal/:slug/deliveries` Delivery Center | client file viewers | approved files/versions/receipts | signed downloads، expiry، download audit |

## 4. Task Details Experience

| Tab | المحتوى | edit authority |
|---|---|---|
| Overview | status، owner، dates، priority، project/workspace، custom fields | field-level + state |
| Description | rich safe text/brief، version note | `task.update` |
| Subtasks | child progress/owners | `subtask.manage` |
| Checklist | grouped by workflow/manual | assignee؛ override permission |
| Workflow | pinned version، current stage، allowed actions، SLA | engine commands فقط |
| Comments | internal/client channels منفصلة بصرياً | matching comment permission |
| Files | attachments، versions، scan/retention/visibility | file permissions |
| Time | timer/entries/estimate summary | self/team permissions |
| Reviews | requests، version diff، decisions/change cycles | reviewer/reader scope |
| Activity | domain/audit projection | resource viewers؛ raw audit restricted |
| Relationships | dependencies، parent/children، related tasks | task manage |
| Custom Fields | typed definitions/values | definition/resource permissions |

Client portal لا يعيد استخدام internal task payload ثم يخفي tabs؛ يستخدم projection/endpoint منفصل.

## 5. Navigation by Persona

| Persona | primary navigation |
|---|---|
| Owner/GM | Home, Inbox, Approvals, Projects, Clients, Teams, Workload, Reports, Administration, Settings |
| Department/Team Manager | Home, My Work, Inbox, Approvals, Projects, Teams, Calendar, Workload, Time, Reports |
| Employee/Contractor | Home, My Work, Inbox, Calendar, Time, Files المسموحة |
| Client | Portal Dashboard, Projects, Approvals, Deliveries, Notifications |
| System Administrator | platform control plane منفصل، لا internal shell tenant افتراضياً |

## 6. UX Principles

1. Arabic RTL first باستخدام logical properties، واختبارات LTR لاحقاً.
2. filters/sort/view محفوظة في URL وقابلة للمشاركة فقط إذا المتلقي مخول.
3. Command palette (`Ctrl/Cmd+K`) يعرض actions authorized فقط.
4. Quick create يحترم context ولا يتجاوز required fields.
5. keyboard navigation كاملة للboards والdialogs والقوائم.
6. drag-and-drop له buttons/menus بديلة ويستدعي transition command لا local reorder فقط.
7. bulk actions تعرض count، exclusions، preview وpartial result.
8. saved views لها owner/scope/visibility.
9. permission denial يعطي سبباً عملياً عاماً وrequest-access path إن قرره المالك.
10. dangerous actions confirmation؛ undo فقط للعمليات القابلة للتعويض، لا approval/security/delete النهائي.
11. optimistic updates للread state/reactions فقط؛ transitions/permissions/approvals/files non-optimistic أو pending واضح.
12. dialogs accessible: role/name، focus trap، Escape policy، restore focus.
13. toasts قصيرة مع live region؛ الأخطاء الدائمة تبقى inline.
14. loading skeleton، empty states محددة، وretry موضعي.
15. data density هادئة للعمل المتكرر؛ لا hero/marketing composition داخل التطبيق.
16. جميع timestamps تعرض timezone، والـrelative time لا يحجب التاريخ المطلق.
17. financial/HR/client/internal visibility مميزة بصرياً ولا تعتمد على اللون وحده.

## 7. Responsive Model

- 360-767: bottom/compact nav، single task column، sheets للتفاصيل الثانوية.
- 768-1199: collapsible rail، two-pane عند الإمكان.
- >=1200: persistent sidebar، list+detail optional.
- tables: column priority + details drawer، مع accessible full-table mode.
- Workflow Builder وadvanced reports: mobile read/approve فقط؛ edit desktop، وليس حجباً لصلاحية API.

## 8. UI Audit Requirements

يسجل Audit Event عند:

- lifecycle changes، assignments، workflow transitions/overrides.
- review/approval/change request.
- file share/download للـsensitive policy/delete/restore.
- role/permission/membership/settings/integration changes.
- time/attendance/leave corrections/decisions.
- report/audit/data exports.
- AI proposal approval/execution.

view telemetry ليس audit ويخضع للخصوصية.
