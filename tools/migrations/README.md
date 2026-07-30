# V2 Migration Tooling

لا تحتوي هذه المرحلة command يتصل بـ production. نقطة التنفيذ المسموحة هي `runMigrationPreview` في `@zamam/firestore` عبر port محلي أو staging فقط.

## الضوابط

- `environment` يقبل `local` أو `staging` فقط.
- dry run لا يكتب.
- الكتابة تتطلب backup verified.
- الصفحات محدودة إلى 250 وثيقة.
- كل target داخل `v2Organizations/{organizationId}` ويحمل `schemaVersion=2` و`migrationId`.
- writes idempotent عبر `migrationId` في adapter الفعلي.
- أي role أو reference غامض ينتقل إلى report quarantine ولا يحصل على privilege.
- rollback يحذف namespace المعزول في staging فقط بعد التحقق من backup؛ لا يُحذف V1.
- `rollbackStagingMigration` يتطلب adapter وbackup verified ويحذف فقط records المطابقة لنفس `organizationId + migrationId` على صفحات محدودة.

تُضاف adapters والـ field mappings الخاصة بـ `users`, `roles`, `tasks`, `workspaces`, `settings/general` في Prompt migration المخصص قبل cutover.
