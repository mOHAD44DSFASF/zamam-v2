# دليل النسخ الاحتياطي والتعافي

## الأهداف

- الافتراضي `RPO=24h` و`RTO=8h`.
- Firestore managed export يومي إلى storage خاص cross-region وفق قرار الإقامة.
- R2 versioning/retention وinventory يومي للملفات.
- Audit retention سبع سنوات قابلة للضبط؛ archive tasks/projects خمس سنوات؛ deleted files قابلة للاستعادة 30 يوماً ما لم يوجد legal hold.

## تحقق النسخة

كل export يسجل environment، cutoff، schema/migration version، document counts حسب collection/tenant، object count، checksum manifest، ونتيجة reference scan. يمنع `createTenantBackup` اختلاط tenants ويتحقق `validateTenantRestore` من SHA-256 والعدد والحد.

## Rehearsal ربع سنوي

1. اختر نسخة staging غير حساسة.
2. استعد إلى مشروع معزول جديد، وليس فوق المصدر.
3. شغّل schema converters وtenant/reference/count reconciliation.
4. اختبر login personas وtask/workflow/approval/file signed download.
5. قس زمن الاستعادة وسجل RPO/RTO الفعلي.
6. أتلف البيئة المعزولة وفق سياسة retention بعد اعتماد التقرير.

## حادث

أعلن incident، جمّد writes إن لزم، احفظ logs/audit، حدد cutoff، اختر آخر export صالح، استعد إلى بيئة بديلة، أعد events idempotently بعد cutoff، ثم نفذ controlled DNS/cohort cutover بواسطة السلطة المخولة. أي تضارب idempotency أو tenant يوقف الاستعادة.

## ما لم يُنفذ

لم تُنشأ jobs أو buckets production ولم تُختبر صلاحيات cloud الفعلية في هذا التشغيل. هذه متطلبات GO خارج المستودع وليست دليلاً على امتثال قانوني.
