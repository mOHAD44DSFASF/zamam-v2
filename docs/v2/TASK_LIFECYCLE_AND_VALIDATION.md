# Task Lifecycle and Validation

الحالة: **منفذ في Prompt 12**.

## Aggregate

الكيانات المنفذة: `task`, `subtask`, `checklist`, `checklist_item`, `task_assignment`. جميعها tenant-owned وتحمل `organizationId`, `schemaVersion`, `version`, وbackend timestamps.

`TaskService` في `services/functions/src/task/service.ts` هو مسار الكتابة الوحيد في V2. واجهة `apps/web/src/features/tasks/TaskManagementPage.tsx` لا تستورد Firestore وتستخدم HTTP contracts فقط.

## دورة الحالة

| من | إلى |
|---|---|
| `draft` | `ready`, `cancelled` |
| `ready` | `in_progress`, `blocked`, `cancelled` |
| `in_progress` | `blocked`, `in_review`, `completed`, `cancelled` |
| `blocked` | `in_progress`, `cancelled` |
| `in_review` | `in_progress`, `approved`, `cancelled` |
| `approved` | `completed`, `cancelled` |
| `completed` | `archived` |
| `cancelled` | `archived` |
| `archived` | لا يوجد |

`blocked` يتطلب سببًا. `completed` يسجل `completedAt`. إعادة الفتح عملية مستقلة تتطلب `task.reopen`, سببًا موثقًا، وتنقل `completed -> ready`. لا يمكن تعديل مهمة terminal مباشرة.

## التحقق والمراجع

- العنوان 2..200 حرف بعد التطبيع.
- الوصف حتى 20,000 حرف.
- `dueAt` ISO UTC صالح.
- المشروع بحالة تشغيلية ومن المؤسسة نفسها.
- Workspace نشط ومتوافق مع المشروع.
- parent task من المشروع نفسه وغير terminal.
- assignee موظف نشط أو فريق نشط.
- checklist حتى 100 item في command واحد؛ item حتى 500 حرف.
- كل update/transition/reopen/archive/checklist response يتطلب `expectedVersion`.

## Assignment

`task_assignment` سجل مستقل؛ لا توجد مصفوفة trusted داخل task. الإنشاء يتطلب `task.assign` ويبدأ `pending`. الرد يتطلب `task.claim`، ويقبله فقط `userId` الموجود في assignment ولمرة واحدة. الملكية أو الإسناد لا يولدان permission ضمنيًا.

## Audit وidempotency

كل command يمر عبر `AuditCommandService` في معاملة واحدة مع business record وaudit event وoutbox event. إعادة `idempotencyKey + fingerprint` نفسها تعيد النتيجة دون تكرار، والتعارض يفشل.

الأحداث الأساسية: `task.created`, `task.updated`, `task.transitioned`, `task.reopened`, `task.archived`, `task.assigned`, assignment response، `subtask.created`, وchecklist events.

## الأرشفة

تتطلب `task.archive`, حالة `completed` أو `cancelled`, وعدم وجود workflow instance نشط. الأرشفة soft state ولا تحذف السجل أو التاريخ.

## واجهة المستخدم

المسار `/tasks` عربي RTL ويقدم list/detail/create/edit، وحالات loading/error/empty. التعديل يرسل الحقول المتغيرة فقط ولا يسمح بتغيير `projectId` أو `workspaceId`. العمليات الطرفية لا تعرض زر تعديل.

## الاختبارات

- `tests/task-management.test.ts`: 9 اختبارات domain/service.
- `tests/task-ui.test.tsx`: 3 اختبارات RTL, accessibility, create/edit contract.

