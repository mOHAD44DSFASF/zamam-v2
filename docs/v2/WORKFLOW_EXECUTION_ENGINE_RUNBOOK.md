# Workflow Execution Engine Runbook

الحالة: **منفذ في Prompt 15**.

## بدء Instance

`WorkflowExecutionService.start` يتحقق من `task.transition`, Task mutable، optimistic `expectedTaskVersion`, وWorkflowVersion منشور. تنشأ ذريًا:

- `task_workflow_instance` مثبت على `workflowVersionId`.
- أول `task_stage_execution`.
- رابط `task.workflowInstanceId`.
- audit وoutbox.

لا يقرأ التنفيذ `template.latestVersionId` بعد البدء.

## Command الانتقال

المدخلات: `instanceId`, `transitionKey`, `expectedConcurrencyVersion`, وهوية موثقة وidempotency metadata.

الترتيب:

1. replay lookup قبل state resolution.
2. قراءة النسخة المثبتة والانتقال المتاح من المرحلة الحالية.
3. رفض required permission غير الموجود في catalog.
4. backend authorization على required permission.
5. `WorkflowGatePort` يتحقق من assignment/checklists/files/fields/review evidence.
6. داخل المعاملة: إعادة فحص organization, active state, concurrency, pinned version, current stage, transition definition، وstage execution.
7. إغلاق execution الحالي وفتح التالي.
8. زيادة cycle في rework/backward transition.
9. تحديث instance وإنتاج audit/outbox.

replay لنفس actor/key/fingerprint يعيد النتيجة السابقة ولا يكرر الأثر. key متعارض يفشل.

## SLA

`BusinessCalendarPort` يحسب `stageDueAt` حسب تقويم المؤسسة. `buildOverdueWorkflowQuery` يفحص `active + stageDueAt<=now` بصفحات 50 مرتبة. worker يستدعي `markSlaBreached` بخدمة principal محدودة وصلاحية `task.override_transition`.

الخرق يسجل مرة واحدة على instance والتنفيذ الحالي ويرسل `workflow.sla_breached`. السياسة notification/escalation consumer تنفذ لاحقًا عبر outbox.

## ترقية Active Instance

لا تحدث تلقائيًا. `migrateVersion` يتطلب:

- `workflow.migrate_instances`.
- step-up.
- سببًا موثقًا.
- target منشور ومن template نفسه.
- وجود current `stageKey` في target.
- concurrency version مطابق.

يحفظ from/to في outbox وحقول migration. إذا فشل compatibility يبقى instance على النسخة الأصلية.

## Recovery

- pause consumer: أوقف workflow event consumers فقط؛ commands/outbox تبقى محفوظة.
- duplicate delivery: consumer يفحص event delivery idempotency.
- transition race: أعد تحميل instance واعرض المرحلة الحالية؛ لا تعِد الطلب بمفتاح جديد دون قرار المستخدم.
- invalid pinned version: لا تحول إلى latest؛ افتح incident واقرأ audit/version snapshot.
- SLA backlog: اقرأ pages بحد 50، oldest-first؛ لا تشغل unbounded catch-up.

## الفهارس

- `task_workflow_instance(status ASC, stageDueAt ASC)`.
- `task_stage_execution(workflowInstanceId ASC, cycle ASC, enteredAt ASC)`.
- `task_workflow_instance(taskId ASC, status ASC)`.

## الاختبارات

- `tests/workflow-execution.test.ts`: 9 اختبارات pinning, atomicity, replay, races, gates, rework, migration, SLA.
- `tests/task-ui.test.tsx`: transition UI يستخدم pinned `concurrencyVersion`.

