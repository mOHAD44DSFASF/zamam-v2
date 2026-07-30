# صيغ عبء العمل والسعة والخصوصية

## نطاق Prompt 21

التنفيذ الحالي يبني read model باسم `capacity_plan` من جداول العمل، الخصومات
المعتمدة، وتقديرات assignments. لا يعيد تعيين المهام تلقائيًا، ولا يستخدم
time entries الفعلية كمقياس أداء.

الملفات الأساسية:

- `packages/domain/src/workload.ts`
- `services/functions/src/workload/service.ts`
- `apps/web/src/features/workload/WorkloadPage.tsx`
- `tests/workload-capacity.test.ts`

## الصيغ

لكل مستخدم وفترة:

```text
absenceMinutes = approvedLeaveMinutes + holidayMinutes
availableMinutes = max(0, scheduledMinutes - absenceMinutes)
allocatedMinutes = sum(known active assignment estimatedMinutes)
remainingMinutes = availableMinutes - allocatedMinutes
utilizationPercent = round(allocatedMinutes / availableMinutes * 100)
```

عندما `availableMinutes=0` مع allocation أكبر من صفر، تستخدم القيمة sentinel
`999` للفرز والعرض كـoverallocated. لا تستخدم هذه القيمة للحساب المالي.

| Utilization | Status |
|---:|---|
| 0% إلى 70% | `available` |
| 71% إلى 90% | `balanced` |
| 91% إلى 110% | `at_risk` |
| أكبر من 110% | `overallocated` |

## Unknown ليس Zero

- لا يوجد work schedule: `scheduledMinutes`, `availableMinutes`,
  `utilizationPercent` تكون null والحالة `unknown`.
- assignment بلا estimate: يبقى `unknownAssignmentCount` ويصبح status
  `unknown` حتى لو كانت السعة معروفة.
- الغياب المفقود لا يفترض صفرًا في adapter الإنتاجي؛ يجب أن يعيد المصدر خطأ
  unavailable أو بيانات confirmed. fixture فقط يمكن أن يقرر صفرًا صريحًا.
- واجهة `/workload` تعرض "غير معلوم" وملاحظة تفسيرية، ولا ترسم utilization
  وهميًا.

## Overlap

`countAssignmentOverlaps` يعد الأزواج ذات النوافذ الزمنية المتقاطعة. هو مؤشر
تخطيط لا إثبات conflict فعلي؛ يعرض `assignment_overlap` للتفسير ولا يغير status
وحده. نطاقات غير صالحة مرفوضة.

## حدود الخصوصية

- projection يخزن `absenceMinutes` المجمع فقط؛ لا يخزن leave type أو السبب أو
  ملاحظة طبية.
- لا يخزن salary، compensation، attendance event detail، أو نص المهمة.
- `viewEmployeeNames=false` ينتج projection UI باسم مصغر، ولا ينبغي الاعتماد
  على الإخفاء في UI؛ API يجب أن يطبق `workload.view_*`.
- self: `workload.view_self`.
- team: `workload.view_team` مع resource team scope.
- organization/department: `workload.view_organization`؛ قرار الرؤية الواسعة
  لا يستنتج من role text.
- إعادة البناء تتطلب `workload.manage` وتنتج audit/outbox.

## إعادة البناء والاستعلام

- batch إعادة البناء أقصى 100 عضو حتى تبقى المعاملة دون حد Firestore.
- read query أقصى 50، مفهرس حسب scope والفترة ثم utilization/user.
- document ID حتمي: `capacity-YYYYMMDD-userId`.
- replay محمي بـAuditCommandService idempotency؛ التحديث يزيد `version`.
- كل رقم يحمل `calculatedAt`، والفترة `periodStart/periodEnd`.

## الفهرس

```text
capacity_plan:
organizationId ASC, scopeType ASC, scopeId ASC, periodStart ASC,
utilizationPercent DESC, userId ASC
```

لـunknown values التي لا تحتوي `utilizationPercent` يجب استخدام query منفصل
بـ`status == unknown` أو summary aggregate؛ لا تُسقط من العدد.

## Rollback

تعطيل job وإخفاء route `/workload` يعيدان النظام إلى task operations دون تعديل
tasks أو schedules أو leave. يمكن حذف projections غير الإنتاجية وإعادة بنائها
من المصادر؛ سجلات audit لا تحذف.
