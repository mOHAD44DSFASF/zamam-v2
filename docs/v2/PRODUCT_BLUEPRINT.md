# مخطط المنتج: ZAMAM V2

> الحالة: Proposed V2، وثيقة تخطيط فقط.  
> مرجع V1: `PROJECT_OVERVIEW_AND_AUDIT.md` و`src/`.  
> الترميز: **Confirmed V1** سلوك مثبت؛ **Proposed V2** تصميم مستهدف؛ **Owner decision** قرار مرتبط بمعرف في `OWNER_DECISIONS.md`.

## 1. تعريف المنتج

### 1.1 ما هو ZAMAM V2؟

**Proposed V2:** منصة تشغيل عربية أولاً للوكالات وشركات الخدمات، توحد إدارة المنظمة والعملاء والمشاريع والموارد والمهام وسير العمل والمراجعات والملفات والزمن والحضور والتقارير في سجل تشغيلي واحد قابل للتدقيق.

ليست المنصة مدير مهام بسيطاً؛ فهي تربط:

- من طلب العمل ولماذا ولأي عميل ومشروع.
- من يملك القرار ومن ينفذ ومن يراجع.
- نسخة workflow المنشورة التي تحكم الانتقال.
- الملفات والإصدارات والملاحظات والاعتمادات.
- الزمن والسعة والتأخير ونسبته إلى السبب الصحيح.
- تاريخ عمليات append-only يفسر كل تغيير حساس.

### 1.2 المشكلات التي يحلها

- تشتت الطلبات بين المحادثات والملفات والجداول.
- ضياع المسؤولية بين التنفيذ والمراجعة والاعتماد.
- تأخر التسليم بسبب غياب SLA والتصعيد.
- توزيع عمل غير متوازن وغياب رؤية السعة.
- تقارير أداء غير قابلة لإعادة الحساب أو التفسير.
- مشاركة ملفات وروابط دون ملكية أو retention واضح.
- صلاحيات مبنية على مسميات لا على سياسات قابلة للإنفاذ.
- صعوبة إعطاء العميل رؤية آمنة دون كشف التشغيل الداخلي.

### 1.3 المؤسسات والمستخدمون

الأنواع المستهدفة: وكالات التسويق، إنتاج المحتوى، التصميم، البرمجيات، الاستشارات، إدارة الحملات، وشركات الخدمات ذات العمل المتكرر متعدد المراحل. يبدأ المنتج بمنظمة واحدة، لكن كل كيان tenant-owned يحمل `organizationId`.

المستخدمون: ملاك ومديرون، مدراء أقسام، قادة فرق، مشرفون، موظفون، متعاقدون، عملاء، ومسؤولو تشغيل المنصة.

### 1.4 التموضع اللغوي

- العربية وRTL هما default للواجهة والمحتوى النظامي.
- identifiers وAPI names بالإنجليزية.
- تخزن النصوص القابلة للترجمة بمفاتيح لا hardcoded labels.
- البنية تدعم English/LTR لاحقاً دون قلب منطق layouts.

### 1.5 فرصة SaaS

النموذج tenant-aware، والسياسات والـindexes والـevents مقيدة بالمنظمة. التحول إلى SaaS لاحقاً يحتاج control plane للفوترة والتوفير والدعم، لا إعادة بناء domain أو نقل كل البيانات.

## 2. أهداف المنتج

| الهدف | المقياس المقترح | هدف أول 90 يوماً بعد الإطلاق | ملاحظة |
|---|---|---:|---|
| مركزية العمليات | نسبة المشاريع النشطة المدارة بالكامل في ZAMAM | >= 90% | Platform adoption |
| خفض فوات المواعيد | نسبة المهام overdue | تحسن 30% عن baseline | لا يستخدم لعقاب فردي منفرداً |
| وضوح المسؤولية | مهام نشطة بلا accountable owner | < 2% | يستثنى waiting/automation |
| تسريع المراجعة | median review turnaround | تحسن 25% | يفصل internal/client |
| توازن الحمل | فرق تتجاوز 110% من السعة | < 10% أسبوعياً | يتطلب capacity موثوقاً |
| اكتمال التاريخ | sensitive commands لها audit event | 100% | Gate أمني |
| تقارير موثوقة | تقارير تعاد بنفس النتائج لنفس الفترة | 100% | versioned definitions |
| تقليل العمل اليدوي | automation success دون تدخل | >= 95% للـenabled rules | مع DLQ ومراجعة |

الأهداف الرقمية النهائية **Owner decision OD-MET-01** بعد قياس baseline حقيقي.

## 3. حدود المنتج

### 3.1 Core platform

Organization, departments, teams, memberships, clients, projects, workspaces, tasks/subtasks/checklists, workflows, approvals, comments, files, notifications, audit.

### 3.2 Advanced administration

Custom roles, scoped assignments, retention, exports, environments, integrations, security/session controls، وإدارة custom fields.

### 3.3 Automation

Event-condition-action rules، scheduled triggers، retries، idempotency، run history، manual pause.

### 3.4 AI

تلخيص، اقتراح subtasks، تصنيف الطلبات، اقتراح workload/workflow، وتحضير ردود. التنفيذ التلقائي مقيد بسياسة risk وقرار **OD-AI-01**.

### 3.5 Client-facing

بوابة منفصلة بصلاحيات محدودة: عرض المشاريع المسموحة، الطلبات، الملفات المسلمة، التعليقات client-visible، والاعتمادات.

### 3.6 Future integrations

Cloud storage، calendar، email، messaging، accounting/HR، search provider، BI. لا integration يعد جزءاً من release قبل وجود contract وsecurity review.

### 3.7 مستبعد من أول Production Release

- Billing SaaS وself-service tenant provisioning.
- Payroll وحساب الرواتب.
- تنفيذ AI تلقائي متوسط/عالي المخاطر.
- marketplace للتكاملات.
- offline-first كامل.
- chat عام بديل لتطبيقات التواصل.
- video conferencing.
- تخصيص white-label كامل.

## 4. User Personas

| Persona | المسؤوليات والأهداف | الشاشات والأفعال اليومية | البيانات الحساسة | المخاطر |
|---|---|---|---|---|
| Organization Owner | الملكية، الحوكمة، كبار المديرين، retention | Executive dashboard، settings، roles، audit؛ مراجعة الاستثناءات | كل بيانات المنظمة والمالية حسب OD-FIN-01 | إساءة صلاحية مطلقة؛ يلزم MFA وstep-up |
| General Manager | تشغيل المنظمة والأولويات والسعة | Home، workload، projects، approvals، reports | أداء الموظفين والعملاء | قرارات مبنية على metrics ناقصة |
| Deputy Manager | تفويض المدير واستمرارية التشغيل | نفس نطاق مفوض ومحدد زمنياً | تقارير تشغيلية واسعة | توسع التفويض دون ضبط |
| Department Manager | نتائج القسم وموارده | Department، team workload، approvals، reports | أداء القسم وleave ضمن policy | رؤية خارج القسم |
| Team Leader | توزيع اليوم وحل العوائق | My Team، board، review inbox، capacity | مهام وأداء الفريق | reassignment غير مصرح |
| Supervisor | متابعة project/workspace محدد | Workspace، tasks، reviews، files | بيانات النطاق المسند فقط | الخلط بين role وscope |
| Employee | تنفيذ العمل وتسجيل الزمن والتعاون | My Work، task details، time، notifications | ملفه الوظيفي الشخصي | كشف مهام/تعليقات ليست له |
| Contractor | تنفيذ محدود زمنياً | assigned tasks/files/comments | أقل قدر من بيانات العميل | بقاء الوصول بعد نهاية العقد |
| Client User | طلب ومراجعة واعتماد التسليمات | Client portal، project view، approvals | بيانات عميله فقط | كشف internal comments أو موظفين |
| System Administrator | صحة المنصة لا إدارة أعمال tenant | control plane، incidents، telemetry | metadata تقنية؛ tenant content فقط عبر audited JIT | وصول دعم دائم وغير مدقق |

### نمط اليوم

- Owner/General Manager: مراجعة health وoverdue والاستثناءات، لا micro-management.
- Department/Team management: تخطيط السعة، إزالة blocker، مراجعات واعتمادات.
- Employee/Contractor: inbox ثم My Work ثم task detail، رفع evidence وتسجيل time وانتقال workflow.
- Client: طلب جديد، متابعة delivery، تعليق خارجي، اعتماد أو request changes.
- System Administrator: تنبيهات ومراقبة وتشخيص، مع access مؤقت موثق عند الضرورة.

## 5. الوحدات الوظيفية

| الوحدة | الغرض | الممثلون | تعتمد على |
|---|---|---|---|
| Organization | tenant وسياساته | Owner, SysAdmin | Auth, audit |
| Departments | التقسيم الإداري | Owner, GM | Organization |
| Teams | وحدات التنفيذ | Managers | Department, membership |
| Users | identity lifecycle | Owner, HR/admin | Auth backend |
| Roles/Permissions | تفويض scoped | Owner, authorized admins | Membership, audit |
| Clients | حساب العميل واتصالاته | Account/Project managers | Organization |
| Projects | نطاق وميزانية ومواعيد client work | Managers | Client, members |
| Workspaces | مساحة تعاون مرنة داخل/عبر projects | Teams | Membership |
| Tasks/Subtasks | وحدات التنفيذ | كل العاملين | Project/workspace |
| Checklists | شروط إنجاز قابلة للإثبات | Assignees/reviewers | Task/workflow |
| Workflows | state machine versioned | Process admins | Permissions |
| Reviews/Approvals | قرارات موثقة على version | Reviewers/clients | Workflow, files |
| Comments | تعاون داخلي/عميل | members/client users | Visibility policy |
| Files | metadata/version/retention | authorized members | Object storage |
| Notifications | inbox وقنوات delivery | كل المستخدمين | Events/preferences |
| Time Tracking | زمن فعلي | employees/managers | Tasks/timesheets |
| Workload | السعة مقابل التخطيط | managers | Schedule, assignment, time |
| Attendance | الحضور والانصراف | employee/HR | Work schedule |
| Leave | الطلب والاعتماد | employee/managers/HR | Attendance/capacity |
| Goals/KPIs | تعريف وقياس نتائج | management | Versioned metrics |
| Reports | views/exports | scoped managers | Aggregates |
| Automations | event rules | process admins | Event bus |
| AI Assistant | اقتراحات موثقة | authorized users | AI gateway/audit |
| Client Portal | رؤية خارجية معزولة | clients | Client/project permissions |
| Integrations | OAuth/webhooks/connectors | integration admins | Secrets backend |
| Settings | policy/config | Owner/admins | Organization |
| Audit Logs | تاريخ append-only | auditors | كل sensitive commands |

## 6. Release Scopes

### Foundation Release

| البند | التفصيل |
|---|---|
| Included | environments، trusted backend، Auth lifecycle، tenant boundary، RBAC/scopes، schema/converters، rules، audit، CI/tests/monitoring |
| Excluded | business feature expansion، AI، client portal |
| Dependencies | owner decisions الأمنية والتنظيمية |
| Completion | deny-by-default؛ cross-tenant tests؛ commands audited؛ backup restore drill؛ quality gate Prompt 6 |
| Risks | تعقيد claims/membership؛ migration compatibility |

### Core Operations Release

| البند | التفصيل |
|---|---|
| Included | organization، teams، clients، projects، workspaces، tasks، views، workflow builder/execution، reviews، approvals، templates، comments، files |
| Excluded | HR analytics وAI والعميل الخارجي |
| Dependencies | Foundation، file provider decision |
| Completion | end-to-end task workflows، immutable versions، secure files، migration validated |
| Risks | scope creep، workflow state complexity، legacy mapping |

### Management Release

| البند | التفصيل |
|---|---|
| Included | notifications، workload، capacity، time، timesheets، attendance، leave، KPIs، reports، exports |
| Excluded | autonomous AI، SaaS billing |
| Dependencies | stable tasks/events، owner HR decisions |
| Completion | metrics definitions versioned؛ privacy scopes؛ reconciliation tests |
| Risks | employee surveillance، labor rules، inaccurate baselines |

### Intelligence Release

| البند | التفصيل |
|---|---|
| Included | automations، run history، AI proposals، advanced analytics/recommendations |
| Excluded | unrestricted AI execution |
| Dependencies | event bus، audit، data quality، risk policy |
| Completion | idempotent automation؛ DLQ؛ AI consent/redaction/evaluation |
| Risks | cost، prompt injection، wrong action، privacy |

### Client Experience Release

| البند | التفصيل |
|---|---|
| Included | portal، requests، client-visible project/files/comments، approvals، delivery center، reports |
| Excluded | internal operations، performance/attendance، tenant administration |
| Dependencies | visibility model، external identity، Core/notifications |
| Completion | client isolation tests؛ accessibility؛ branded notifications؛ approval evidence |
| Risks | accidental internal disclosure، identity lifecycle |

## 7. Non-functional Requirements

| المجال | المتطلب |
|---|---|
| Security | deny-by-default؛ backend verification؛ MFA للـprivileged؛ short-lived support access؛ secret manager؛ OWASP review |
| Performance | P75 interactive route <2.5s على mobile target؛ paginated queries؛ no unbounded listeners |
| Scalability | كل query مقيدة بـorganization؛ async jobs؛ partitionable events؛ quotas per tenant |
| Availability | SLO يقرره OD-SLO-01؛ graceful degradation؛ status/incident runbook |
| Accessibility | WCAG 2.2 AA؛ keyboard/focus/labels/contrast/reduced motion |
| Arabic RTL | RTL default؛ logical CSS؛ Arabic date/number display؛ searchable Arabic text |
| English readiness | translation keys، locale-aware formatting، LTR layout tests |
| Mobile | core employee/client flows usable من 360px؛ لا desktop-only critical action |
| Auditability | append-only audit لكل sensitive command والقرار والoverride |
| Retention | policy per entity/file؛ legal hold؛ auditable purge |
| Backup/Recovery | scheduled exports؛ encrypted backups؛ quarterly restore drill؛ RPO/RTO owner-approved |
| Monitoring | structured logs، traces، metrics، correlation ID، alerts، synthetic smoke |
| Errors | stable codes؛ Arabic safe message؛ no sensitive details؛ retry guidance |
| Privacy | data minimization؛ purpose-bound reports؛ export/delete workflow |
| Files | private by default؛ signed access؛ AV scan؛ versioning؛ checksum؛ retention |
| Testability | unit/domain، emulator integration، contract، E2E، security rules، load tests |

## 8. Success Metrics

### Platform health/adoption

- DAU/WAU حسب persona، onboarding completion، workflow adoption.
- command/API success rate، P50/P95 latency، client error rate.
- notification delivery success، automation run success، DLQ size.
- audit coverage، unauthorized access denials، backup/restore success.

### Operational process metrics

- on-time completion rate.
- overdue percentage.
- median/percentile task cycle time.
- review/client approval turnaround.
- workflow completion and rework rate.
- workload utilization distribution، لا المتوسط فقط.
- unassigned/blocker age.

### Employee-performance metrics

يجب فصلها عن platform metrics وعدم تفسيرها بلا context:

- throughput حسب work type/complexity.
- active work time مقابل waiting/review/client delay.
- rework attributed reason.
- capacity adherence مع leave/holidays.
- quality signals من reviews versioned.

لا تستخدم metric فردية آلياً للعقوبة أو التقييم. قواعد visibility والموافقة والاستخدام **Owner decisions OD-MET-02 وOD-PRV-01**.

