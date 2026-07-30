# ADR-0003: V2 Schema, Timestamps and Retention

- **الحالة:** Accepted
- **التاريخ:** 2026-07-30

## القرار

1. V2 staging تحت `v2Organizations/{organizationId}` ولا يكتب إلى collections V1.
2. كل tenant document يحمل `organizationId`, `schemaVersion=2`, optimistic `version`, `createdAt`, `updatedAt`, و`deletedAt` عند soft deletion.
3. Firestore persistence يستخدم `Timestamp` حصراً للـ instants؛ الإنشاء والتحديث عبر server timestamp. domain يمثلها canonical UTC ISO (`YYYY-MM-DDTHH:mm:ss.sssZ`) والعرض يحول إلى timezone المؤسسة.
4. calendar dates مثل leave date تبقى `YYYY-MM-DD` ولا تعامل كـ instant.
5. hard delete ممنوع من repository العام. purge jobs المستقبلية تتبع retention/legal hold.
6. audit append-only وoutbox/idempotency داخل transaction نفسها مع business mutation.

## Retention defaults

- sensitive audit: 7 سنوات قابلة للضبط ولا تقل دون legal review.
- archived tasks/projects: 5 سنوات.
- deleted files: recovery لمدة 30 يوماً ثم purge إذا لا legal hold.
- idempotency: 24 ساعة افتراضياً حسب نوع command.
- completed outbox: 30 يوماً؛ dead-letter حتى التحقيق/السياسة.
- RPO 24 ساعة وRTO 8 ساعات؛ backup/restore rehearsal إلزامي قبل launch.

## التبعات

استخدام JavaScript `Date` أو ISO string داخل persistence document مرفوض في converter. لا يُسمح بتحديث audit event عبر service API، وFirebase Admin bypass لا يلغي تحقق backend.
