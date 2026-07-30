# Autonomous Blockers

| ID | النوع | الدليل | الإغلاق |
|---|---|---|---|
| BLK-002 | External launch | لا legal/privacy/data-residency sign-off | اعتماد المالك/المستشار |
| BLK-003 | External assurance | لا independent penetration أو staging load/DR | تنفيذ وتوقيع تقارير staging |
| BLK-004 | Tooling | sandbox approval quota يمنع final Git write/browser launch حتى 2026-08-05 | إعادة commit/smoke بعد عودة الصلاحية |
| BLK-005 | Workspace | `F:\ZAMAM-main` اختفى؛ العمل في recovery workspace موثق | إعادة النسخ إلى مساحة المالك بعد عودة القرص |

## مغلق

| ID | دليل الإغلاق |
|---|---|
| BLK-001 | `firebase-adapter.ts` يركب `composeFeatureCommandDispatcher` حقيقي؛ 65 `FEATURE_API_PATHS` موصولة بخدمات Prompts 2-27 عبر Firestore-backed ports؛ استثناء موثق: `/v1/auth/invitations/accept` (انظر `docs/v2/P28A_ENDPOINT_COMMAND_MAP.md`) |
| BLK-006 | `services/workers/src/http.ts` يعالج الأحداث فعليًا (claim/ack/retry/dead-letter عبر Firestore)؛ transport محلي حتمي للاختبارات وPub/Sub حقيقي fail-closed للإنتاج (`services/workers/src/transport.ts`)؛ Firestore trigger يربط outbox الذري الموجود مسبقًا بالـtransport؛ automation matching معزول per-tenant؛ 435/435 tests |

لا يحل أي بند عبر bypass أو production-first experiment.
