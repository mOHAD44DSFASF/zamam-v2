# قاموس المؤشرات ونسب البيانات

## Catalog المنشور

| formulaKey | المعادلة | no-data | الاستخدام |
|---|---|---|---|
| `on_time_rate` | `onTimeCount / completedCount * 100` بدقة منزلتين | null إذا completed=0 | تشغيلي |
| `average_cycle_minutes` | `cycleMinutesTotal / completedCount` | null | تشغيلي |
| `review_turnaround_minutes` | `reviewMinutesTotal / reviewCount` | null | تشغيلي |
| `accountable_delay_minutes` | `assignee + unattributed` | 0 إذا source مؤكد | performance-sensitive |

لا توجد formulas نصية أو code execution. أي metric جديد يحتاج إصدار تعريف جديد،
fixture، review للخصوصية، وقرار اتجاه/وحدة.

## Lineage and Reproducibility

كل `kpi_measurement` يثبت `kpiDefinitionId`, `definitionVersion`, subject,
period, `cutoffAt`, `sourceHash`, `sourceRunId`, `calculatedAt`. المعرف حتمي من
هذه القيم. نفس المدخلات تعيد السجل نفسه؛ اختلاف cutoff أو source hash ينشئ قياسًا
جديدًا ولا يكتب فوق التاريخ.

## Attribution

وفق `OD-MET-01`، دقائق `reviewer`, `client`, `dependency`, `system` لا تنسب إلى
الموظف. `unattributed` يبقى ظاهرًا في metric الحساس حتى يصحح السبب، ولا يستخدم
النظام KPI لاتخاذ قرار وظيفي تلقائي.

## Export

`report.export` يتطلب step-up. field whitelist يأتي من backend projection policy.
jobs غير متزامنة، 10,000 صف و30 حقلًا كحدين، CSV cells quoted، والقيم التي تبدأ
`= + - @` تحيّد لمنع spreadsheet injection. الملف النهائي يجب أن يمر عبر File
Service الخاص وي expire خلال 24 ساعة.

## Privacy Gates

- performance يحتاج `performance.sensitive.view`.
- financial يحتاج permission مالي منفصل ولا يدرج في fields الافتراضية.
- DepartmentManager يرى operational افتراضيًا لا الأداء الفردي.
- client projection لا يحتوي employee KPI.
- متطلبات الدولة القانونية `OD-PRV-01` شرط launch.

## Rollback

إيقاف calculation/export workers لا يغير measurements المنشورة. تبقى definitions
والlineage، وتلغى queued jobs دون حذف audit. warehouse اختياري وغير منفذ حاليًا.
