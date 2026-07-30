# Gate P24: Management Data

النتيجة: **PASS** محليًا في 2026-07-30. لا production data ولا deploy ولا
external export.

| البوابة | الدليل | النتيجة |
|---|---|---|
| Security | permission catalog يفصل HR/performance/financial؛ service يطلب `performance.sensitive.view` وexport step-up؛ field whitelist؛ Firestore deny-default 5/5 | PASS |
| Data | time approved immutable + correction replacement؛ attendance correction evidence؛ leave reserve/consume ledger؛ KPI version/cutoff/source hash | PASS |
| Tests | `npm.cmd run check`: 48 files و375 tests؛ emulator 5/5 | PASS |
| Formula | fixtures للـ4 formulas؛ no-data null؛ attribution يستبعد client/reviewer/dependency/system؛ deterministic measurement replay | PASS |
| Export | async job، 10k row/30 field bounds، CSV injection defense، expiry 24h، no unauthorized field | PASS |
| Performance | queries محدودة 50؛ projection batches 100؛ exports async 10k؛ bundle entry 13.75KB وأكبر JS 345.83KB | PASS |
| Documentation | `WORKLOAD_CAPACITY_FORMULAS_AND_PRIVACY.md`, `TIME_TRACKING_TIMESHEET_POLICY.md`, `ATTENDANCE_LEAVE_PRIVACY_POLICY.md`, `METRIC_DICTIONARY_AND_DATA_LINEAGE.md` | PASS |

## Reconciliation

- Workload يخصم aggregate absence فقط.
- Leave reservation لا تؤثر في capacity؛ `leave.approved` النهائي فقط يؤثر مرة.
- Timesheet يجمع stopped entries في فترة `localDate` ويقفلها بالاعتماد.
- Attendance holiday/leave priority مع correction evidence.
- KPI measurement لا يعيد قراءة "الآن" عند العرض؛ يحمل cutoff وsource hash.

## STOP checks

- KPI غير قابل للإعادة: غير مثبت؛ deterministic ID وfixture نجحا.
- Unauthorized export: الطلب المرفوض لا ينشئ job.
- Performance leakage: UI وservice يتطلبان capability/permission.
- Financial leakage: لا توجد فواتير/payroll؛ billable والميزانية projections منفصلة.

## قيود غير مانعة

قياس P95 على staging warehouse غير متاح دون بنية production؛ الحدود والasync path
مثبتان، وload test staging مطلوب في Prompt 28. المتطلبات القانونية الإقليمية ما
زالت owner/launch decision.

## القرار

**Proceed إلى Prompt 25.**
