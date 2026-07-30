# Workflow Builder Validation and Versioning

الحالة: **منفذ في Prompt 14**.

## الرسم التعريفي

`WorkflowDefinition` في `packages/domain/src/workflow.ts` يتكون من `startStageKey`, stages, transitions. الشروط بيانات allowlisted (`field`, `equals|not_equals|exists`, scalar value) وليست JavaScript أو expression قابلة للتنفيذ.

الحدود: 2..50 stages و1..200 transitions. المفاتيح normalized identifiers، والأسماء 2..100 حرف.

## شروط صلاحية النشر

`validateWorkflowDefinition` يرفض:

- start غير موجود.
- stage/transition keys مكررة.
- reference مفقود أو self transition.
- stage غير قابل للوصول من start.
- عدم وجود terminal stage.
- terminal له outgoing transition.
- non-terminal بلا outgoing transition.
- stage لا يملك أي مسار إلى terminal.
- permission أو condition غير صالح.

`simulateWorkflowPaths` لا ينفذ actions؛ يستعرض المسارات حتى 100 path ويحد rework loop إلى زيارتين لكل stage.

## Versioning

- ينشأ `workflow_template` و`workflow_version(status=draft, versionNumber=0)`.
- تعديل draft يتطلب `workflow.manage` و`expectedVersion`.
- النشر يتطلب `workflow.publish` وstep-up.
- النشر يعيد التحقق داخل المعاملة، وينشئ `workflow_version(status=published)` ونسخ stages/transitions.
- كل published version يحمل `definitionHash`, `versionNumber`, `publishedAt`, `publishedBy`.
- لا يعدل published version؛ محاولة `updateDraft` عليه تفشل `PUBLISHED_WORKFLOW_IMMUTABLE`.
- تعديل لاحق يتم على draft مستقل وينتج versionNumber جديد.

الـ Task instances في Prompt 15 ستثبت `workflowVersionId`; لا يوجد mutable latest lookup أثناء التنفيذ.

## UI

المسار `/workflows/:templateId/builder` يقدم graph مرتبًا RTL، stage editing، validation evidence، simulation، save، وpublish command صريح. زر النشر disabled عندما draft غير صالح؛ backend يعيد التحقق دائمًا.

## Audit

draft create/update وpublish تمر عبر `AuditCommandService` وتنتج outbox events. لا يخلق فشل النشر stage records جزئية بسبب المعاملة.

## الاختبارات

- `tests/workflow-builder.test.ts`: 9 اختبارات graph/version/concurrency/atomic publish.
- `tests/workflow-builder-ui.test.tsx`: 3 اختبارات accessibility/simulation/save/publish.

