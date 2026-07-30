# Gate P27: Client Experience

النتيجة: **PASS محلياً** في 2026-07-30. لم يحدث اتصال production أو deploy أو إرسال خارجي.

| البوابة | الدليل | النتيجة |
|---|---|---|
| Security | `PortalService` يتحقق من client identity والحساب والعضوية و`clientAccountIds` وعضوية project صريحة؛ DTO allowlist؛ 5 اختبارات عزل | PASS |
| Data | `ClientRequest` و`ClientDelivery` tenant-owned؛ الطلبات audited/idempotent؛ approval يحمل reviewed version | PASS |
| Internal leakage | serialization test يحجب internal comment/task وmanager/department/assignee/financial/objectKey | PASS |
| Files | Portal يعرض file id/name/version فقط؛ التنزيل عبر endpoint grant قصير ومراجعة `FileService` | PASS |
| Tests | `npm.cmd run check`: 54 files و397 tests؛ Firestore emulator: 5/5 | PASS |
| Accessibility/RTL | Portal dashboard/project وAutomation وAI تمر عبر `jest-axe`؛ `dir=rtl`؛ محتوى عربي وإنجليزي smoke | PASS |
| Performance | project memberships بحد 50؛ كل projection بحد 100؛ lazy chunks: Portal 7.52 KB، AI 6.56 KB؛ bundle budgets PASS | PASS |
| Rollback | `CLIENT_PORTAL_ENABLED` يعطل البوابة؛ revoke sessions/grants؛ العمليات الداخلية مستقلة | PASS |
| Documentation | threat/visibility/content matrix وسياسة AI وrunbooks للأتمتة والملفات والإشعارات | PASS |

## STOP checks

- Cross-client/cross-org access: مرفوض قبل جلب project payload.
- Project enumeration: الخطأ العام `PORTAL_PROJECT_DENIED`.
- Internal comment/file key leakage: غير موجود في JSON الناتج.
- Disabled provider: AI fail-closed؛ notifications تبقى in-app؛ لا إرسال حقيقي.
- Firestore client writes: deny-default recursive rule ما زال يرفضها.

## قيود الإطلاق غير المانعة للتنفيذ

- يلزم اختبار أجهزة ومتصفحات حقيقية ومراجعة اختراق مستقلة قبل GO.
- يلزم اعتماد قانوني لسياسة الخصوصية ومعالجة بيانات العملاء.
- القياسات production-like وowner launch authority تخص Prompt 28.

## القرار

**Proceed إلى Prompt 28.**
