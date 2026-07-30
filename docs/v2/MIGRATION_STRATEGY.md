# استراتيجية الانتقال الآمن من ZAMAM V1 إلى V2

> **Proposed V2.** لا migration تنفذ في Prompt 1. هذه الخطة لا تتصل بإنتاج ولا تفترض صحة بيانات V1.

## 1. مبادئ غير قابلة للتفاوض

1. لا migration مباشرة على production أولاً.
2. لا privileged production migration من browser/client SDK.
3. التنفيذ لاحقاً عبر Admin SDK في بيئة controlled، service account من Secret Manager، ومشغل مخول.
4. backup واختبار restore قبل أي write.
5. كل run يحمل `migrationVersion`, `runId`, code commit، source snapshot، counters.
6. كل operation idempotent؛ rerun لا يكرر documents أو events.
7. failed documents تسجل بمعرف/hash وreason آمن، لا raw PII.
8. validate counts، references، tenant ownership، permissions، timestamps، file reachability.
9. rollback محدد قبل cutover.
10. legacy remains read-only حتى acceptance/retention، ولا يحذف فوراً.

## 2. Current Inventory

**Confirmed V1 collections من الكود:**

- `users`
- `roles`
- `tasks`
- `workspaces`
- `settings/general`

| دليل V1 المؤكد | المسار/الموضع الحالي | دلالته للهجرة |
|---|---|---|
| قراءة المستخدم ورفض `isDeleted` بعد تسجيل الدخول | `src/pages/Login.tsx` | `isDeleted` ليس بديلاً كافياً لتعطيل Auth أو إبطال الجلسة |
| قراءة `tasks` كاملة وتصفية المرحلة محلياً | `src/pages/EmployeeWorkspace.tsx` داخل تحميل البيانات | يلزم بناء assignments وtenant-scoped queries قبل cutover |
| زيادة `currentStage` داخل `handleMarkDone` | `src/pages/EmployeeWorkspace.tsx`، `handleMarkDone` | لا توجد workflow history موثوقة يمكن اختراعها أثناء الهجرة |
| CRUD مباشر لـ `users`, `roles`, `tasks`, `workspaces`, `settings/general` | `src/pages/AdminDashboard.tsx` | الكتابات المميزة يجب أن تنتقل إلى backend commands |
| تخزين `requiresAdminApproval`, `requiresFileUpload`, `pipeline`, `currentStage` | `src/components/TaskCreationModal.tsx` | الحقول legacy تتحول إلى candidates ولا تثبت تنفيذ approval |
| تعريف شكل Task الحالي | `src/types.ts`، النوع `Task` | المصدر typed جزئياً، لكن البيانات الفعلية تحتاج inventory |
| إعداد Firebase client | `src/lib/firebase.ts` | لا يستخدم في أداة migration؛ تستخدم Admin SDK لاحقاً |
| مسارات الملفات الخارجية | `src/lib/r2Service.ts` و`src/lib/googleDrive.ts` | الروابط تعامل كـ `legacy_external` حتى التحقق الآمن |

مصادر خارج Firestore:

- Firebase Authentication users.
- attachment/file URLs تشير إلى storage خارجي غير موثق بالكامل.
- Google Drive links/IDs قد تكون placeholders أو حقيقية؛ لا تفحص آلياً بلا قرار.

لا توجد rules/index/schema/migration files أو audit history في repo.

## 3. Pre-migration Inventory

ينتج inventory read-only في staging copy:

- document count لكل collection/status/role.
- field presence/type distribution.
- Timestamp/ISO/Date-like values وinvalid values.
- duplicate emails/user IDs/role references.
- tasks بلا title/pipeline/workspace/creator.
- pipeline stage number duplicates/gaps/unknown roles/users.
- status values الفعلية وغير المعروفة.
- workspace member/supervisor references.
- attachments shape، duplicate URLs، protocol/provider classification.
- soft-deleted users وحالة Auth المقابلة.
- document size percentiles.
- orphan references.

كل نتيجة تحفظ كartifact آمن redacted ومقارن بالـsnapshot.

## 4. Backup and Environments

### 4.1 Environments

- `development`: emulators/fixtures فقط.
- `staging`: مشروع Firebase مستقل وstorage مستقل، production-like rules.
- `production`: cutover بعد sign-off فقط.

لا يعاد استخدام API keys/credentials بين environments.

### 4.2 Backup

1. Firestore managed export مع manifest/count/checksum.
2. Firebase Auth export عبر أداة إدارية مع encryption/access controls.
3. file-object inventory وprovider backup/versioning.
4. security rules/index/config snapshot.
5. restore drill إلى isolated project.

RPO/RTO والretention **OD-RET-04/OD-SLO-01**.

## 5. Schema Versioning

- V1 legacy docs تعامل `schemaVersion=1` منطقياً حتى لو field غير موجود.
- V2 يبدأ `schemaVersion=2`.
- migration registry يسجل `version, runId, sourceSnapshot, startedAt, completedAt, status, counts, codeHash`.
- converters لا تقبل unknown future version.
- read adapters تعرض explicit `LegacyRecord` ولا تحوله بصمت إلى domain aggregate.

## 6. Data Mapping

### 6.1 Organization and settings

| V1 | V2 | التحويل/القرار |
|---|---|---|
| implicit single organization | `organizations/{orgId}` | ID يولد في controlled migration؛ لا يستخدم project ID |
| `settings/general.isDriveConnected` | integration candidate + organization feature setting | لا يهاجر `true` كاتصال صالح؛ status=`needs_reauthorization` |

### 6.2 Users and roles

| V1 field | V2 target | rule |
|---|---|---|
| Auth UID/doc ID | global `User` + org `members/{uid}` | match Auth export؛ unmatched quarantined |
| `uid` optional | derived identity | لا يثق بحقل إذا يخالف doc/Auth UID |
| `displayName` | User Profile + member snapshot | trim؛ empty flagged |
| `email` | Auth identity/email hash؛ encrypted contact where needed | لا ينسخ raw email إلى broad member docs |
| `role` text/ID | reviewed `RoleAssignment` | لا يمنح permissions تلقائياً؛ mapping approval required |
| `createdAt` Date/Timestamp/ISO | canonical Timestamp | parse strict؛ preserve `sourceCreatedAtRawType` in migration log فقط |
| `updatedAt` ISO | Timestamp | strict parse |
| `isDeleted` | membership disabled + employment ended/suspended decision | revoke token/Auth disable في cutover command، لا مجرد field |
| role docs `name,isSystem` | V2 Role | preserve ID as `legacyKey`; custom permissions start deny/minimal pending review |

### 6.3 Workspaces

| V1 | V2 | rule |
|---|---|---|
| doc ID/name | Workspace | preserve legacy ID mapping؛ status active unless invalid |
| `members[]` | `workspaceMembers` | validate active user; role=`member` |
| `supervisors[]` | `workspaceMembers` + scoped assignment | permission mapping owner-approved |
| same ID in both arrays | one membership + strongest approved role | report conflict |
| `createdBy` missing/invalid | nullable migration actor metadata + audit note | لا يخترع user |
| timestamps | canonical Timestamp | invalid -> migration timestamp مع `sourceTimeMissing=true` |

### 6.4 Tasks

| V1 field | V2 target | rule |
|---|---|---|
| ID | Task legacy mapping | preserve stable mapping table |
| title/description/priority | Task | normalize known enum؛ unknown flagged |
| status | V2 Task status | explicit mapping table؛ unknown -> `blocked` + review، لا guess |
| `createdAt` | Timestamp | strict parse؛ invalid flagged |
| missing `createdBy` | `createdBy=migrationService`; `legacyCreatorUnknown=true` | لا تنسب لشخص |
| `workspaceId` | Workspace ref | orphan -> null + issue/holding workspace only إذا owner approves |
| `pipeline[]` | draft Workflow Template candidate + instance/executions | grouping strategy below |
| `currentStage` | current execution | validate stage exists؛ otherwise blocked/manual review |
| stage `status` | غير موثوق | لا يستخدم لبناء history |
| `requiresAdminApproval` | migration flag + candidate approval stage | لا ينشئ قرار approval سابق |
| `requiresFileUpload` | transition requirement candidate | owner/workflow review |
| `attachments[]` | files/fileVersions/resourceAttachments | URL inventory؛ status=`legacy_external` حتى verify |
| `fileLink`, `driveFolderId` | Integration-linked file/folder reference | no credential inference؛ visibility needs review |
| `completedAt` ISO | Timestamp | only if mapped status completed and valid |

### 6.5 Pipeline conversion

1. canonicalize pipeline definition excluding assignee IDs/status.
2. hash definitions لتجميع identical patterns.
3. generate **draft** templates فقط.
4. owner/process manager reviews actors/actions/requirements.
5. publish approved versions.
6. each task pins approved version or a safe `legacy_manual` published version.
7. create synthetic Stage Execution للحالة الحالية فقط:
   - `enteredAt` unknown/migration time.
   - previous stages `status=legacy_assumed_passed` غير مسموح كdomain status؛ تحفظ كمmigration evidence خارج operational executions، أو executions موسومة `source=legacy, evidenceLevel=unknown`.
8. append `migration.task_imported` audit event؛ لا تخترع approval/reviewer/history.

## 7. File Migration

- inventory URL provider/protocol فقط؛ لا download production content في dry run.
- decide primary storage provider **OD-INT-01** وسياسة الاحتفاظ بالإصدارات **OD-FIL-02**.
- create file metadata with `status=legacy_external`, `scanStatus=unknown`, private visibility.
- access via controlled proxy/signed link after authorization.
- optional copy job لاحقاً: fetch allowlisted provider، checksum، scan، store، verify، switch version atomically.
- failed copy leaves legacy reference ولا يحذف الأصل.
- no client-visible share until visibility review.

## 8. Migration Tool Design

Proposed later:

```text
tools/migrations/v1-to-v2/
  inventory
  transform
  validate
  apply
  reconcile
  rollback
```

خصائص:

- CLI non-interactive، explicit environment/project allowlist.
- `--dry-run` default؛ `--apply` يتطلب change ticket/confirmation.
- bounded batches، checkpoints، resume.
- idempotency document per source doc + transform version.
- structured redacted output.
- writes only target V2 namespace during initial phases.
- no deletes in migration command.

## 9. Validation

### Document validation

- required fields/types/enums/schemaVersion.
- every tenant doc `organizationId`.
- every reference target exists أو issue approved.
- unique reservations.
- no cross-org refs.
- workflow graph/instance stage compatibility.
- membership/role assignments reviewed.
- file metadata/provider/visibility.

### Reconciliation

| metric | acceptance |
|---|---|
| source documents accounted | 100% = migrated + explicitly quarantined |
| silent drops | 0 |
| cross-tenant references | 0 |
| unknown privileged role grants | 0 |
| completed task count | matches approved mapping |
| attachment records | every source item accounted |
| timestamp parse failures | 100% listed، 0 silent fallback |
| permission probes | all allow/deny fixtures pass |

## 10. Incremental Phases

### M0: Decisions and tooling

Freeze V2 schema/mappings، staging، backup، rules tests، migration tool.

### M1: Foundation shadow

Create target namespace في staging فقط؛ migrate organization/users/roles as non-authoritative. Validate.

### M2: Structure

Departments/teams/workspaces/memberships. Resolve conflicts. No V1 behavior change.

### M3: Tasks/files shadow

Migrate snapshots/templates/file metadata. V2 read-only comparison screens/internal reports.

### M4: Trusted command cutover

All new privileged mutations route through backend.  
Dual-write مبرر فقط خلال short bounded window إذا V1 يجب أن يبقى usable:

- backend command is sole writer.
- writes V2 authoritative then legacy projection via outbox.
- idempotency/reconciliation mandatory.
- React never writes both.

إذا لا يمكن فرض sole writer، استخدم maintenance window بدل dual-write.

### M5: Read cutover by cohort

Feature flag teams/roles، compare counts/behavior، rollback to V1 reads without reversing data.

### M6: Full cutover

Stop V1 writes، final delta migration، token revoke/role enforcement، switch reads، smoke/security validation.

### M7: Observation and legacy read-only

Monitor 2-4 weeks حسب owner؛ reconciliation daily؛ V1 collections read-only.

### M8: Cleanup

بعد retention/sign-off فقط: archive exports، remove adapters، schedule legacy purge منفصل. لا حذف آلي ضمن cutover.

## 11. Rollback

### Before read cutover

Stop migration، discard target staging/V2 namespace، أصل V1 untouched.

### During cohort

Feature flag يعيد cohort إلى V1 reads؛ backend command outbox يحافظ legacy projection إن dual-write فعال.

### After full cutover

- stop V2 writes/queues.
- drain/record pending events.
- restore routing إلى last known compatible UI/API.
- use legacy projection only if reconciliation green؛ otherwise restore verified backup إلى isolated target ثم planned recovery.
- external side effects لا "ترجع" تلقائياً؛ compensating actions per integration.

Rollback trigger: authorization regression، count/reference mismatch، corruption، sustained critical error، أو missing audit.

## 12. Cutover Checklist

- backup + restore drill passed.
- all P0 owner decisions approved.
- migration dry run and two staging rehearsals passed.
- rules/backend authorization tests passed.
- no unknown role grants.
- file/visibility policy approved.
- queues/DLQ empty or understood.
- V1 write freeze enforced.
- final delta counts/references validated.
- smoke tests لكل persona.
- rollback operator/runbook/on-call ready.
- change/audit record created.

## 13. Legacy Cleanup Constraints

- لا rename/delete V1 collections أثناء migration.
- لا purge users/tasks/files required for audit/legal retention.
- preserve source-to-target mapping.
- remove hardcoded V1 privileged behavior only in later implementation prompt after backend/permissions ready.
- delete legacy external files only after checksum copy، access verification، retention approval.
