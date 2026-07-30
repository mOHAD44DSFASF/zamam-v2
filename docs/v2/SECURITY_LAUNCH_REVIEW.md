# مراجعة أمن الإطلاق

## الضوابط المثبتة

- Backend-only privileged writes وFirestore recursive deny-default.
- revoked Firebase ID token verification وApp Check لكل API route؛ public auth لا يحتاج bearer لكنه يحتاج App Check وrate limit وidempotency.
- tenant/resource/scope/business-state authorization مع unknown permission deny.
- MFA/step-up للصلاحيات الحساسة.
- atomic audit/outbox/idempotency؛ persistent API rate/idempotency state.
- strict Portal projections، internal/client comment/file separation، signed short grants.
- AES-GCM/HMAC لبيانات اتصال العميل عبر secret provider boundary.
- CSP و`nosniff` و`no-referrer` وPermissions Policy.
- AI redaction/proposal hash/proposal-only؛ automation allowlist/service principal/depth/quota.

## Dependency triage في 2026-07-30

`npm audit --omit=dev`: 0 Critical، 2 High، 6 Moderate. High في `react-router` RSC action CSRF؛ ZAMAM يستخدم declarative `BrowserRouter` SPA ولا يستخدم RSC/Data Router actions، لذلك المسار المتأثر غير قابل للوصول في التطبيق الحالي، لكن يعاد فحصه قبل كل release. Moderate في سلسلة `firebase-admin`/Google Storage؛ ZAMAM لا يستخدم Google Cloud Storage upload path ويستخدم R2 adapter، مع ذلك تبقى الترقية المدعومة مطلوبة بعد تحقق compatibility. لا تُطبق downgrade آلية مقترحة من audit.

## متطلبات GO

- مراجعة اختراق مستقلة للـPortal وIDOR/file grants.
- تفعيل MFA/App Check/CORS/Secret Manager وCloud IAM في staging/production.
- إغلاق أي advisory يصبح قابلاً للاستغلال.
- تدوير الأسرار بعد rehearsal، وإثبات عدم وجود secret في artifact/logs.
- اعتماد قانوني للخصوصية والإقامة والاحتفاظ.
- نجاح `npm run check:launch-readiness`؛ هذا الفحص جزء من Firebase predeploy ويفشل مغلقاً حتى تركيب runtime وتقديم evidence واعتماد authority.

## مخاطر مقبولة مؤقتاً في الكود

ملفات V1 المباشرة ما زالت موجودة لأغراض المقارنة والمigration لكنها غير reachable من `App.tsx`. إزالتها تتطلب إثبات migration/rollback وقرار منفصل. `DisabledFeatureCommandDispatcher` يغلق Firebase feature routes حتى تركيب service handlers المعتمد؛ لا يوجد fallback غير موثوق.
