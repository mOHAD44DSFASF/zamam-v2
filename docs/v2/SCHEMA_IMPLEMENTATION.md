# تنفيذ V2 Schema وFirestore Foundation

## Entity coverage

`packages/domain/src/entities.ts` يعرّف 60 tenant entity kinds تغطي Organization، people، clients/projects، tasks، workflow، collaboration/files، management، automation/AI، audit/integrations/custom fields. `UserIdentity` وحده global؛ `UserProfile` وEmployment وكل البيانات التشغيلية organization-bound.

`ENTITY_DESCRIPTORS` هو coverage registry؛ test fixture يفشل إن لم يقبل أي kind `organizationId` و`schemaVersion=2`.

## Paths

```text
v2Organizations/{organizationId}/{entityKind}/{entityId}
v2Organizations/{organizationId}/_idempotency/{key}
v2Organizations/{organizationId}/_auditEvents/{eventId}
v2Organizations/{organizationId}/_outboxEvents/{eventId}
v2Organizations/{organizationId}/_counters/audit-sequence
```

هذه namespace staging معزولة. لا توجد migration أو dual-write إلى production.

## Repository rules

- IDs محدودة pattern وطولاً.
- create يضيف schema/version/server timestamps.
- update يتطلب `expectedVersion` ويمنع الحقول immutable.
- archived document لا يقبل update عادي.
- archive soft-only.
- list limit بين 1 و100 و`orderBy` إلزامي.
- path نفسه يحمل tenant boundary؛ لا collection-group query في repository العام.
- client DTOs تستخدم explicit `projectFields` allowlist.

## Atomic command

`AuditCommandService.execute` ينفذ داخل transaction واحدة:

1. idempotency lookup/fingerprint check.
2. business mutation.
3. audit sequence.
4. append-only audit event.
5. outbox event.
6. completed idempotency response + expiry.

الفشل يلغى معه business transaction، ثم يسجل failure audit منفصل. denied sensitive authorization يسجل في `TrustedAuthorizationService`.

## Index/query plan

| الشاشة المستقبلية | filters/order | الحد |
|---|---|---:|
| My tasks | assignee + status + dueAt | 50 |
| Team tasks | teamId + status + updatedAt desc | 50 |
| Project tasks | projectId + archived=false + updatedAt desc | 50 |
| Review/approval queues | reviewerId + status + dueAt | 50 |
| Notifications | userId + status + createdAt desc | 50 |
| Attendance/leave/time | user/scope + period + date desc | 100 |
| Audit | resource/actor/event + occurredAt desc | 100 |
| Automation runs | automationId + status + createdAt desc | 50 |

تُضاف composite indexes عند تنفيذ repository لكل module، ويُرفض أي query بلا pagination. لا index file تخميني أضيف في P6.

## Backup/restore

`createTenantBackup` ينتج payload مرتباً وmanifest بعدد records وSHA-256. `validateTenantRestore` يرفض checksum/count/tenant mismatch. الاختبار يقوم rehearsal محلياً بلا Firebase.

## Migration skeleton

`runMigrationPreview` يقبل local/staging فقط، pages ≤250، dry run بلا writes، وverified backup قبل staging write. records المتعارضة أو غير المملوكة تدخل quarantine report. راجع `tools/migrations/README.md`.

## نتيجة Gate P6

تم توفير JRE 21 محلي معزول وتشغيل Firestore Emulator دون credentials أو اتصال production. اجتازت rules suite أربع حالات فعلية: self-session read، منع anonymous، منع client writes، ومنع forged role/permission claims عبر organization boundaries. النتيجة الكاملة موثقة في `docs/v2/gates/GATE_P6_FOUNDATION.md`.
