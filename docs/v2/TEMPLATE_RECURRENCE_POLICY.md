# سياسة القوالب والعمل المتكرر

## النطاق

هذه السياسة هي العقد التشغيلي لـ Prompt 17. القالب (`work_template`) تعريف قابل لإعادة الاستخدام لإنشاء `task` أو `project`، وليس مورد عمل حيًا. الجدول (`recurrence_schedule`) يربط قالبًا منشورًا بقاعدة زمنية وهوية تشغيل ونطاق صلاحية. كل occurrence ينتج سجلًا دائمًا (`recurrence_run`) ومعرّفًا حتميًا.

## الملكية والصلاحيات

- كل سجل يحمل `organizationId`، وكل قراءة أو كتابة تتحقق منه في trusted backend.
- `template.create` ينشئ مسودة فقط، و`template.publish` عملية حساسة تتطلب step-up authentication.
- `recurrence.manage` ينشئ الجدول أو يوقفه أو يستأنفه، و`recurrence.run` مخصص للـ scheduler identity.
- لا تمنح `runAsUserId` صلاحيات جديدة. يجب حل العضوية النشطة والنطاق وقت كل تشغيل، وإيقاف الجدول عند فقدانها.
- الواجهة تعرض capabilities فقط؛ الإخفاء لا يمثل authorization.

## الإصدار والنشر

المسودة قابلة للتعديل عبر optimistic concurrency. النشر يثبت payload و`workflowVersionId` المنشور. أي تغيير لاحق ينشئ إصدارًا جديدًا؛ لا يعاد تفسير الأعمال التي ولدت سابقًا. لا يمكن إنشاء جدول من مسودة أو workflow version غير منشور.

## الزمن

- التخزين UTC بصيغة canonical ISO، والاحتساب يعتمد timezone من IANA مثل `Africa/Cairo`.
- `timeLocal` يمثل وقت المؤسسة المحلي. تغيّر DST يحافظ على الوقت المحلي لا على offset ثابت.
- إذا وقع الوقت داخل فجوة DST، يحرك المحرك التنفيذ إلى أول دقيقة محلية صحيحة. التوقيت المكرر يختار أول instant مستقبلي حتمي.
- التكرار يدعم `daily` و`weekly` و`monthly`. اليوم الشهري محصور 1–28 في الإصدار الأول لتجنب قواعد نهاية الشهر الضمنية.
- **Owner default مطبق:** catch-up لا يتجاوز 10 occurrences لكل دورة معالجة؛ ما زاد يبقى مؤجلًا ولا يولد دفعة غير محدودة.

## منع التكرار والتزامن

`recurrence_run.id = SHA-256(scheduleId:occurrenceAt)` بعد تقصيره وببادئة ثابتة. إنشاء سجل التشغيل والمورد الناتج وتقديم `nextRunAt` يقع داخل transaction واحدة. `idempotencyKey` على command يمنع إعادة التنفيذ على retry، و`expectedVersion` يحمي أوامر الإدارة. الاستعلام العامل محدود بـ 50 سجلًا ويرتب الأقدم أولًا.

## الفشل والتراجع

- فشل materialization يلغي transaction كاملة؛ لا يسجل تشغيل ناجح ولا يقدم الموعد.
- retry يستخدم نفس occurrence وidempotency key.
- الإيقاف المؤقت لا يحذف الأعمال المنشأة. الاستئناف يحسب أول موعد مستقبلي من `resumeAfter`.
- عند فشل صلاحية `runAs` أو القالب، يسجل failure تشغيلي، يوقف الجدول بعد حد المحاولات، وينبه المدير. توصيل هذا التنبيه ضمن Prompt 20.
- rollback الآمن هو pause للجداول المتأثرة؛ لا تحذف `recurrence_run` ولا الموارد الناتجة.

## التشغيل والمراقبة

المقاييس المطلوبة: queue age، due schedules، نجاح/فشل/إعادة المحاولة، duplicate prevention، ومدة materialization. الإنذارات: أقدم موعد متأخر عن SLA، failure متكرر، أو schedule بلا identity نشطة. يمنع scheduler الاستعلام غير المحدود، وتنفذ كل دفعة بحد زمني وcorrelation ID.

## قيود الإصدار

لا يشمل هذا Prompt محرك automation العام، إنشاء recurring checklist مستقل، أو تنفيذ إرسال خارجي حقيقي. هذه الحدود موثقة وتبقى خلف backend contracts.
