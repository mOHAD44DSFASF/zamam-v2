# Autonomous Blockers

| ID | النوع | الدليل | الإغلاق |
|---|---|---|---|
| BLK-001 | Launch/code | `firebase-adapter.ts` يستخدم `DisabledFeatureCommandDispatcher` | تركيب واختبار handlers لكل `FEATURE_API_PATHS` |
| BLK-006 | Launch/code | `services/workers/src/http.ts` يعيد `WORKER_TRANSPORT_NOT_CONFIGURED` | تركيب authenticated queue/event transport وpersistent delivery store |
| BLK-002 | External launch | لا legal/privacy/data-residency sign-off | اعتماد المالك/المستشار |
| BLK-003 | External assurance | لا independent penetration أو staging load/DR | تنفيذ وتوقيع تقارير staging |
| BLK-004 | Tooling | sandbox approval quota يمنع final Git write/browser launch حتى 2026-08-05 | إعادة commit/smoke بعد عودة الصلاحية |
| BLK-005 | Workspace | `F:\ZAMAM-main` اختفى؛ العمل في recovery workspace موثق | إعادة النسخ إلى مساحة المالك بعد عودة القرص |

لا يحل أي بند عبر bypass أو production-first experiment.
