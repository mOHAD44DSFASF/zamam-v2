# معمارية API والـBackend الموثوق لـZAMAM V2

> **Proposed V2.** V1 لا يحتوي backend؛ `src/pages/*.tsx` يكتب Firestore مباشرة، و`src/lib/r2Service.ts` و`googleDrive.ts` يتصلان بخدمات خارجية. V2 يمنع privileged business operations داخل React.

## 1. مقارنة الخيارات

| الخيار | المزايا | القيود | ملاءمة ZAMAM |
|---|---|---|---|
| Firebase Cloud Functions | Auth/Firestore triggers، callable auth context، managed scaling، scheduled functions | cold starts/limits، long jobs أقل ملاءمة، coupling | ممتاز للcommands القصيرة وevents |
| Google Cloud Run | containers، timeouts/resources أفضل، HTTP/jobs، observability | deployment/ops أعقد، auth wiring | ممتاز للAI/export/file/search/workers |
| Standalone Node.js API | portability وسيطرة كاملة | hosting/queues/security/ops على الفريق، ازدواج Firebase tooling | جيد مستقبلاً، زائد حالياً |
| Hybrid Functions + Cloud Run | Functions قرب Firebase؛ Run للأعمال الثقيلة | يحتاج contracts/trace موحدين | **الموصى به** |

## 2. التوصية

Hybrid:

- **Cloud Functions 2nd gen**: callable/HTTP commands القصيرة، Auth hooks، Firestore outbox triggers، schedules البسيطة.
- **Cloud Run services/jobs**: AI gateway، exports، file scanning/processing، search indexing، report aggregation، integrations الثقيلة.
- **Pub/Sub + Cloud Tasks**: events، delayed/retry work، rate-limited delivery.
- **Firestore**: operational store/outbox/idempotency.
- **Object storage**: private objects؛ provider adapter يمكنه استخدام R2 أو GCS بعد قرار.
- **Secret Manager**: credentials/OAuth tokens، references فقط في Firestore.
- **BigQuery** لاحقاً: analytics/audit archive.

هذا يقلل تغيير stack الحالي، يضمن backend verification، ويمنح مسار SaaS دون API monolith مبكر.

## 3. حدود الثقة

```text
React SPA (untrusted input)
  -> API Gateway/Callable auth
  -> Command Handler
  -> Authentication + Authorization Policy
  -> Domain Service + Transaction
  -> Firestore aggregate + Outbox + Audit
  -> Pub/Sub/Cloud Tasks
  -> Workers/Integrations/Notifications
```

- ID token يثبت identity فقط؛ membership/permissions تحل server-side.
- Firebase custom claims تحمل hints صغيرة مثل platform flag/permission version، لا full tenant ACL.
- Firestore direct reads محدودة بالrules؛ privileged writes backend-only.
- events الخارجية لا تصبح domain events قبل signature/replay/tenant validation.

## 4. Proposed Code Areas

هذه مسارات **مقترحة فقط** لمراحل لاحقة:

```text
apps/web/
services/functions/src/
services/workers/src/
packages/domain/
packages/contracts/
packages/authorization/
packages/firestore/
packages/observability/
infra/firebase/
```

لا تنشأ في Prompt 1.

## 5. Backend Modules

الاختصارات: `Tx` transaction boundary، `Idem` idempotency مطلوب، `AE` audit event.

| Module | المسؤوليات والعمليات العامة | dependencies/auth | Tx/events | failure/idempotency |
|---|---|---|---|---|
| Authentication Adapter | verify token، invite/reset/disable/revoke، step-up context | Firebase Admin؛ `user.*` | Tx profile+membership where possible؛ `user.invited/disabled`؛ AE | compensate Auth/profile partial؛ Idem invite/disable |
| Organization Service | provision/update/suspend، settings | platform/Owner permissions | org+settings+outbox؛ `organization.created/updated` | reservation for slug؛ Idem provision |
| User Service | membership، profile، employment lifecycle | Auth, Org, Authorization | membership/profile transaction؛ user events؛ AE | reject last Owner removal؛ Idem |
| Role/Permission Service | roles، assignments، permission version | catalog + membership؛ `role.*` | assignment+permission version؛ `role.assigned`؛ AE | deny escalation؛ Idem assignments |
| Client Service | client/contact/archive/portal access | Project/Auth؛ `client.*` | client+contact/member refs؛ events؛ AE | revoke portal on archive؛ Idem create |
| Project Service | project lifecycle/members | Client, Roles؛ `project.*` | project/member/outbox؛ `project.created` | state/reference guards؛ Idem |
| Task Service | create/update/assign/archive/reopen/bulk | Project/Workspace/Workflow؛ `task.*` | aggregate+assignments+outbox؛ task events | optimistic conflict؛ Idem all commands |
| Workflow Service | template/version publish/migrate/transition orchestration | Task, Approval, Policy | instance/execution/task/outbox atomic؛ transition events | version conflict/gate codes؛ Idem transition |
| Approval Service | request/slots/decision/delegate/change request | Workflow, Notification؛ `review.*`,`task.approve` | decision+review+outbox atomic | first-effective/all policy races؛ Idem decision |
| Comment Service | internal/client comments، mention/reaction | visibility/membership؛ comment perms | comment+mentions+outbox؛ `comment.mentioned` | sanitize/length؛ Idem create |
| File Service | upload intent/finalize/version/share/delete/restore | storage adapter, scanner؛ file perms | metadata+outbox؛ `file.uploaded` | signed expiry/checksum؛ Idem finalize/delete |
| Notification Service | inbox/preferences/routing؛ `NotificationProjectionService` يستهلك outbox | event bus/audience/preferences | notification + delivery atomic per recipient | deterministic dedupe by recipient/event؛ payload minimization؛ critical override |
| Notification Delivery Worker | digest grouping/email delivery/retry/DLQ | recipient directory/provider | claim ثم provider ثم delivered/retry | batch 50؛ SHA-256 idempotency؛ لا work data في البريد |
| Workload Projection Service | حساب schedule ناقص absence مقابل assignment estimates وإعادة بناء `capacity_plan` | People/Schedule/Leave/Task sources | source reads ثم audited projection transaction | batch 100؛ unknown لا يتحول صفرًا؛ لا HR reason في projection |
| Time Tracking Service | timer/entries/timesheets/adjust | Task/Employment؛ time perms | entry/timesheet+AE | overlap/version checks؛ Idem timer stop/submit |
| Attendance Service | record/import/correct/reconcile | Schedule/Leave؛ attendance perms | daily logical record + event | dedupe device events؛ correction supersedes |
| Leave Service | request/balance/approve/cancel | Employment/Schedule/Workflow | request+capacity impact+outbox | overlap/balance transaction؛ Idem |
| Reporting Service | aggregates/KPI/export | read models/warehouse؛ report perms | async job records؛ `report.ready` | snapshot cutoff، retry/reconcile، Idem export |
| Automation Service | validate/publish/trigger/run/action | event bus + all target services | run record/action commands | bounded retry، DLQ، action idempotency |
| AI Gateway | redact/policy/model call/proposal/evaluate | files/search/domain read APIs؛ AI perms | request/proposal/audit; no direct high-risk write | timeout/cost limits/prompt injection؛ Idem request |
| Audit Service | append/query/export redacted events | all modules؛ `audit.*` | append in transaction/outbox; immutable | write failure blocks sensitive command or durable outbox |
| Integration Service | OAuth/connectors/webhooks/sync health | Secret Manager, queues؛ integration perms | integration state+events/AE | signature/replay/rate/retry/DLQ |
| Search Service | index tenant-visible projections/query | events + authorization filters | async index | eventual consistency، rebuild checkpoints |

## 6. Command and Query API

### 6.1 Callable vs HTTP

- Firebase callable: authenticated first-party UI commands القصيرة، مع App Check.
- Versioned HTTP JSON `/v2/...`: portal/integration/public contracts، OAuth، webhooks.
- Signed upload URLs: HTTP intent/finalize، لا proxy large bytes عبر Functions.
- Queries: Firestore direct read فقط عندما rules تعبر policy بأمان؛ otherwise query endpoints/read models.
- long operations: create job ثم poll/notification.

### 6.2 Request validation

- shared versioned schemas في proposed `packages/contracts`.
- reject unknown fields للcommands الحساسة.
- IDs، enums، lengths، URL protocols، file metadata، timezone/date ranges validated.
- server overwrites actor/org/audit fields.
- validation errors لا تكشف existence خارج scope.

### 6.3 Response envelope

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "requestId": "opaque",
    "correlationId": "opaque",
    "apiVersion": "v2",
    "nextCursor": "opaque-or-null"
  }
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "VERSION_CONFLICT",
    "messageKey": "errors.versionConflict",
    "retryable": false,
    "fieldErrors": []
  },
  "meta": { "requestId": "opaque" }
}
```

لا stack trace أو provider response أو secret.

### 6.4 Error catalog

`UNAUTHENTICATED`, `SESSION_REVOKED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `VERSION_CONFLICT`, `STATE_CONFLICT`, `REQUIREMENT_NOT_MET`, `RATE_LIMITED`, `IDEMPOTENCY_CONFLICT`, `DEPENDENCY_UNAVAILABLE`, `TIMEOUT`, `INTERNAL`.

### 6.5 List conventions

- cursor opaque وموقع server، لا offset.
- `limit` default 25، max policy.
- sort allowlist مع deterministic `id` tiebreaker.
- filters allowlist، organization implied لا client-supplied authority.
- field projection حسب permission.

## 7. API Security and Reliability

| الموضوع | السياسة |
|---|---|
| Idempotency | header/key required للcreates/transitions/decisions/external callbacks |
| Correlation | generated at edge، propagated events/jobs/logs/audit |
| Rate limit | identity+organization+IP class+operation risk؛ provider-specific queues |
| Retry | only retryable codes، exponential jitter، bounded attempts |
| Timeout | short commands؛ async job before external/long work |
| Versioning | `/v2` + schema version؛ additive changes؛ deprecation window |
| Logging | structured، redacted، no PII/file/body/token؛ sampling |
| Audit | business/security record مستقل عن operational logs |
| App Check | first-party callable defense، ليس بديلاً عن auth |
| CORS | explicit origins per environment |
| Secrets | Secret Manager؛ rotation؛ no frontend/build/firestore |

## 8. Domain Event Architecture

### 8.1 Outbox

كل command يكتب aggregate mutation + `domainEvents` outbox في transaction. Dispatcher ينشر إلى Pub/Sub ويضع event `dispatched`; consumers dedupe بـ`eventId + consumer`.

### 8.2 Event catalog

| Event | producer | consumers |
|---|---|---|
| `user.invited`, `user.disabled` | Auth/User | notifications، audit projection، assignment cleanup |
| `project.created` | Project | search، notifications، analytics |
| `task.created` | Task | workflow start، notifications، search |
| `task.assigned` | Task | inbox، workload، notifications |
| `task.transitioned` | Workflow | next assignment، SLA، analytics، automation |
| `task.overdue` | Deadline job | escalation، notifications، reports |
| `review.requested/completed` | Approval | inbox، workflow، notifications |
| `approval.requested/completed` | Approval | workflow، client notification، audit |
| `comment.mentioned` | Comment | notification |
| `file.uploaded` | File | scanner، preview، search metadata |
| `leave.requested` | Leave | approval، capacity، notification |
| `automation.triggered` | Automation | runner |

### 8.3 Retry and dead letter

- consumer acknowledges بعد durable side effect/result.
- exponential retry بحد أقصى حسب event.
- poison messages إلى DLQ مع redacted diagnostic.
- replay requires permission وAE.
- order only per aggregate where required؛ `aggregateVersion` rejects out-of-order projection.
- audit event يرتبط بـcommand correlation، وليس نسخة مكررة من كل consumer log.

## 9. Background Processing

| Job | schedule/trigger | implementation | safety |
|---|---|---|---|
| Deadline reminders | Cloud Tasks delayed + reconciliation schedule | Functions/Run worker | dedupe task+threshold+dueVersion |
| Overdue detection | frequent scheduled query partitions | Function | state/version check قبل event |
| Daily summaries | user timezone batches | Run job | preference/quiet hours |
| Weekly reports | organization schedule | Run/BigQuery | snapshot cutoff، scoped links |
| File cleanup | retention queue + daily reconcile | Run job | legal hold، two-phase delete |
| Notification delivery | event-driven queues | provider workers | provider rate limit/DLQ |
| Automation | domain event/schedule | Run worker | run idempotency، action allowlist |
| KPI aggregation | event incremental + nightly reconcile | Run/warehouse | definition version |
| AI processing | queued request | isolated Run service | redaction، budgets، no direct write |
| Data export | async job | Run job | encryption، expiry، scoped fields |
| Search indexing | domain events + rebuild job | Search worker | tenant filter، checkpoints |

## 10. Transactions and Sagas

- single aggregate/closely colocated Firestore docs: transaction.
- Auth + Firestore، storage + Firestore، external provider: saga/outbox with compensating action.
- no distributed transaction illusion.
- saga state visible in job/run record.
- partial success returns accepted/job status، لا false success.

## 11. Observability

- metrics: command rate/error/latency، authorization denies، queue age، DLQ، Firestore reads/writes، storage bytes، AI cost.
- traces عبر edge -> command -> transaction -> event -> worker.
- health endpoints no dependency secrets.
- alerts by SLO/error budget.
- audit != logs؛ كلاهما retention وسياسة وصول مختلفة.

## 12. Cost and Scale Controls

- bounded queries/listeners، aggregation projections.
- per-organization quotas للautomation/AI/export/file.
- Cloud Run min instances فقط لخدمات latency-critical بعد قياس.
- file bytes direct-to-storage.
- archive high-volume event/audit/metrics إلى warehouse حسب retention.
