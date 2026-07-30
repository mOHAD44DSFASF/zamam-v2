# سياسة تتبع الوقت وكشوف الساعات

## القرارات المعتمدة

- `OD-TIM-01`: التتبع غير إلزامي افتراضيًا؛ قابل للضبط حسب Department/Project.
- `OD-TIM-02`: صاحب السجل يطلب تصحيحًا، والموافق ينشئ النسخة المعدلة.
- payroll وinvoicing خارج Prompt 22.

## الوقت والتقريب

- الحفظ UTC بصيغة ISO؛ `localDate` مشتق من IANA timezone للموظف.
- المدة تقرب إلى أقرب دقيقة، بحد أدنى دقيقة.
- entry الواحد لا يتجاوز 24 ساعة.
- نطاقات الوقت half-open: `[startedAt, endedAt)`؛ نهاية سجل يمكن أن تساوي بداية
  التالي دون overlap.
- future manual entries مرفوضة.
- يعمل timer واحد فقط لكل مستخدم داخل المؤسسة.

## Lifecycle

```text
Time entry: draft -> submitted -> approved
                         \-> rejected -> submitted
Approved correction: approved original + pending correction
                    -> approved replacement (supersedesEntryId)
                    -> rejected correction

Timesheet: open/rejected -> submitted -> approved | rejected
```

السجل الأصلي المعتمد لا يتغير عند التصحيح. عند الموافقة ينشأ `time_entry` جديد
بحالة approved و`supersedesEntryId`، بينما يوثق `time_correction` القرار والمراجع
والوقت. التقارير يجب أن تختار النسخة الفعالة وألا تجمع الأصل والبديل معًا.

## Security

| Operation | Permission | Constraints |
|---|---|---|
| start/stop/manual/correction request | `time.track` | owner user resource؛ active membership |
| view self | `time.view_self` | own entries only |
| view team | `time.view_team` | explicit team scope |
| submit | `timesheet.submit` | owner؛ stopped draft/rejected entries only |
| approve/reject | `timesheet.approve` | scoped manager؛ self approval denied |
| approve correction | `time.adjust` | scoped approver؛ self approval denied |
| unlock | `timesheet.unlock` | غير منفذ في P22؛ يتطلب سياسة منفصلة وstep-up |

`billable` بيانات مالية. لا تعرض الواجهة العلامة دون `viewBillable` capability،
ولا يمنح `time.view_team` وحده صلاحية بيانات مالية.

## Transaction and Limits

- start timer يفحص idempotency قبل running precondition.
- stop يحسب المدة ويفحص overlap ثم يستخدم expected version.
- submit يحدث timesheet وكل entries في معاملة واحدة، بحد 100 entry.
- approve/reject يحدث sheet وentries submitted في معاملة واحدة.
- كل command يكتب audit وoutbox وidempotency record.
- read list محدود بـ50 وcursor.

## Failure and Recovery

- تعطل client لا يوقف timer تلقائيًا؛ المستخدم يعود ويوقف السجل نفسه.
- timer قديم يحتاج correction flow، لا تعديل مباشر.
- فشل submit لا يغير جزءًا من الفترة بسبب atomic transaction.
- تعطيل module يوقف أوامر جديدة؛ تصدّر السجلات المفتوحة وتسوّى قبل rollback.
- لا تعتمد هذه البيانات للرواتب قبل سياسة compliance ومراجعة قانونية منفصلة.

## Tests

`tests/time-tracking.test.ts` يغطي rounding، overlap، timezone، idempotent timer،
period submission، self approval، approved lock، immutable correction. واجهة RTL
وaccessibility في `tests/time-ui.test.tsx`.
