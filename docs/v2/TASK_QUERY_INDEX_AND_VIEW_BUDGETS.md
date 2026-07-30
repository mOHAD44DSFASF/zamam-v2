# Task Query, Index, and View Budgets

الحالة: **منفذ في Prompt 13**.

## Trust boundary

`TaskQueryService` في `services/functions/src/task/query.ts` يفوض قبل القراءة. filters القادمة من URL أو client لا تنشئ scope:

- `self`: يبدأ من `task_assignment(userId, status=accepted)`.
- `team`: يبدأ من `task_assignment(teamId, status=accepted)`.
- `project`: يثبت `projectId`; أي project filter مختلف يفشل `FILTER_SCOPE_ESCALATION`.
- `organization`: يتطلب `task.view_all`.
- search: يتطلب `search.use` ويستقبل `permittedProjectIds` المحسوبة خادميًا.

لا توجد قراءة غير محدودة أو تحميل collection ثم ترشيحها أمنيًا في React.

## Limits

| العملية | الحد |
|---|---:|
| task/assignment page | 50 |
| task IDs المحلولة من assignment page | 50 unique |
| search query | 2..120 حرف |
| search result | 20 |
| statuses filter | 9 |
| priorities filter | 4 |

كل page لها cursor. provider يعيد أكثر من الحد يسبب `SEARCH_PROVIDER_LIMIT_VIOLATION`.

## Firestore indexes المتوقعة

هذه خطة وليست deploy:

- `task_assignment(userId ASC, status ASC, updatedAt DESC)`.
- `task_assignment(teamId ASC, status ASC, updatedAt DESC)`.
- `task(projectId ASC, updatedAt DESC)`.
- `task(projectId ASC, workspaceId ASC, updatedAt DESC)`.
- `task(projectId ASC, status ASC, priority ASC, updatedAt DESC)`.
- `task(workspaceId ASC, status ASC, dueAt ASC)`.
- `task(status ASC, priority ASC, updatedAt DESC)` لنطاق organization المصرح.

يجب مراجعة index usage في emulator/staging قبل إضافة تركيبات أخرى لمنع index explosion.

## Saved views

`SavedTaskViewService` يتحقق من allowlist صريح للمرشحات والعرض (`list|board|calendar|timeline`). العرض الخاص يتطلب `saved_view.create`; المشاركة تتطلب `saved_view.share` ونطاق team عند اختيار `team`. الإنشاء audited وidempotent.

Saved view يخزن تفضيلات الطلب فقط. عند التنفيذ يعاد تقاطعها مع scope الحالي؛ تغيير permissions قد يقلص النتائج ولا يحافظ على وصول قديم.

## UI

`/tasks?view=` يحفظ طريقة العرض في URL. list/board/calendar/timeline تعرض فقط الصفحة bounded التي أعادها backend. mobile يستخدم horizontal scroll للـ board وrows مبسطة للتقويم والخط الزمني.

## الاختبارات

- `tests/task-views.test.ts`: 6 اختبارات scope/query/search/saved-view.
- `tests/task-ui.test.tsx`: يغطي board projection وsave command إضافة إلى اختبارات Prompt 12.

