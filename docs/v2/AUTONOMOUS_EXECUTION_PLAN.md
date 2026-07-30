# خطة التنفيذ الذاتية لـ ZAMAM V2

## نطاق التنفيذ

تنفيذ Prompts 2-28 بالتسلسل من `IMPLEMENTATION_ROADMAP.md`، مع checkpoint محلي بعد كل milestone وبوابات إلزامية بعد P6 وP11 وP17 وP20 وP24 وP27 وP28.

## المراحل

| المرحلة | Prompts | الناتج الأساسي | بوابة الإيقاف |
|---|---:|---|---|
| الأساسات | P2-P6 | monorepo، auth، backend، authorization، schema/audit | Gate P6 |
| التنظيم والعملاء | P7-P11 | organization، employees، clients، projects، workspaces | Gate P11 |
| العمل التشغيلي | P12-P17 | tasks، views، workflows، approvals، templates | Gate P17 |
| التعاون | P18-P20 | comments، files، notifications | Gate P20 |
| الإدارة | P21-P24 | workload، time، attendance/leave، reports | Gate P24 |
| الذكاء والبوابة | P25-P27 | automation، AI، client portal | Gate P27 |
| الإطلاق | P28 | hardening، runbooks، launch evidence | Gate P28 |

## بروتوكول كل Prompt

1. قراءة المتطلبات والاعتماديات والقرارات المعتمدة.
2. تحديث `AUTONOMOUS_PROGRESS.md` إلى `In progress`.
3. تنفيذ أصغر slice كامل عبر domain/contracts/backend/UI.
4. إضافة unit، integration، وE2E حسب المخاطر.
5. تشغيل `typecheck`, `lint`, `test`, `build` والفحوص الأمنية ذات الصلة.
6. تحديث التوثيق ومصفوفة الاختبار وسجل القرار.
7. إنشاء Git checkpoint محلي وصفي.

## ضوابط البيئة

- التطوير والاختبار محليان فقط وبـ mocks/emulators.
- لا deploy ولا production data ولا رسائل خارجية حقيقية.
- القيم الحساسة تأتي من environment ولا تسجل أو تطبع.
- أي تكامل بلا credential يعمل في disabled/demo mode.
