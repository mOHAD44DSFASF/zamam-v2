# مصفوفة أحداث وقنوات الإشعارات

## حدود التنفيذ

هذا المستند يصف تنفيذ Prompt 20 الحالي. مصدر الإشعار هو `OutboxEvent` موثوق، وتنفذ
`NotificationProjectionService` في `services/functions/src/notification/service.ts`
الإسقاط. لا تستدعي خدمات الأعمال مزود البريد مباشرة، ولا تقبل قائمة المستلمين أو
نص البريد من العميل.

## مصفوفة الأحداث

| Event | الجمهور الذي يحله backend | In-app | Email | Critical | المرجع المسموح |
|---|---|---:|---:|---:|---|
| `task.created` | الأعضاء ذوو وصول task | نعم | حسب التفضيل | لا | `taskId` |
| `task.assigned` | المعيّن والمراقبون المصرحون | نعم | حسب التفضيل | لا | `taskId` |
| `task.transitioned` | المعنيون ذوو الوصول الحالي | نعم | حسب التفضيل | لا | `taskId` |
| `task.overdue` | المعيّن ومسار التصعيد | نعم | حسب التفضيل | لا | `taskId` |
| `review.requested` | المراجعون الفعالون | نعم | حسب التفضيل | لا | `reviewRequestId` |
| `approval.requested` | الموافقون الفعالون | إلزامي | فوري إلزامي | نعم | `approvalId` |
| `approval.completed` | أصحاب المصلحة المصرحون | إلزامي | فوري إلزامي | نعم | `approvalId` |
| `comment.created` | mentions/watchers بعد فحص visibility | نعم | حسب التفضيل | لا | `commentId` |
| `file.available` | أصحاب المورد بعد فحص الوصول | نعم | حسب التفضيل | لا | `fileId` |
| `file.quarantined` | uploader ومسؤولو الأمن | إلزامي | فوري إلزامي | نعم | `fileId` |
| `leave.requested` | سلسلة الاعتماد المصرحة | نعم | حسب التفضيل | لا | `leaveRequestId` |
| `security.user_disabled` | المسؤولون الأمنيون المعنيون | إلزامي | فوري إلزامي | نعم | `userId` |

الأحداث غير المعروفة لا تنشئ إشعارًا. تكرار `sourceEventId + recipientUserId +
eventType` ينتج `notificationId` حتميًا، لذلك replay لا ينشئ إشعارًا منطقيًا ثانيًا.

## سياسة المحتوى

- سجل `notification` يحتوي `titleKey` و`previewKey` ومعرف مورد مسموحًا فقط.
- لا يخزن إسقاط الإشعار نص التعليق أو اسم الملف أو الوصف أو internal notes.
- البريد يحتوي عنوانًا عامًا، نصًا يطلب تسجيل الدخول، ورابطًا إلى
  `/notifications`. لا يحتوي بيانات عمل.
- `NotificationAudiencePort` يعيد فقط مستلمًا فعالًا لديه `canAccess=true`، ويعاد
  فحص الحساب والبريد عند وقت التسليم.
- `visibility=client` لا يمنح وصولًا؛ هو projection label بعد فحص المورد. لا يرى
  client أي internal comment أو file.

## التفضيلات والوقت

- القنوات المدعومة: `inApp` و`email`. SMS وWhatsApp خارج Prompt 20.
- digest: `immediate | daily | weekly | never`.
- quiet hours زوج `HH:mm` مع IANA timezone. الزوج الناقص أو timezone غير صالح
  مرفوض.
- الوقت محفوظ UTC، والعرض والجدولة يحترمان timezone مثل `Africa/Cairo`.
- daily عند 08:00 محليًا؛ weekly يوم الاثنين 08:00 محليًا.
- أحداث critical لا يمكن كتمها، وتفرض in-app وemail الفوريين.
- تعطيل email لحدث غير critical هو unsubscribe لذلك الحدث؛ لا يوجد رابط عام
  يكشف هوية المستخدم.

## Queue وRetry وDLQ

`NotificationDeliveryJob` في
`services/workers/src/notification-delivery.ts` يعالج 50 عنصرًا كحد أقصى:

1. claim بشرط `expectedVersion`.
2. تجميع daily/weekly حسب المؤسسة والمستلم؛ immediate لا يجمع.
3. إعادة فحص المستلم.
4. إرسال بـ idempotency key من SHA-256 لمعرفات delivery المرتبة.
5. نجاح المزود يحدّث كل العناصر إلى delivered.
6. الفشل يعاد بمحاولة exponential bounded حتى 8 محاولات.
7. المحاولة الثامنة تنتقل إلى dead-letter مع `lastErrorCode` مصغر.

حالات 429 و5xx قابلة لإعادة المحاولة. رفض 4xx غير 429 يصنف
`EMAIL_PROVIDER_REJECTED`، ويظل قرار retry/DLQ مركزيًا في job. لا يسجل API key أو
عنوان المستلم أو provider response body.

## Runbook محلي

| حالة | التشخيص | الإجراء |
|---|---|---|
| provider غير مهيأ | `EMAIL_PROVIDER_NOT_CONFIGURED` | تحقق من أسماء env في `services/functions/.env.example`؛ استخدم `local` في التطوير |
| ارتفاع retries | راقب error code وqueue age | أوقف السحب مؤقتًا إذا كان المزود rate-limited؛ لا تعدل payload |
| DLQ | عنصر بلغ 8 محاولات | أصلح السبب، تحقق من وصول المستلم، ثم نفذ retry إداريًا بإذن `notification.admin_retry` ومفتاح idempotency جديد |
| تسريب محتوى محتمل | payload يتضمن work data | **STOP**؛ عطل consumer، احتفظ بسجل audit، ولا تعاود الإرسال |
| مستخدم معطل | directory يعيد `active=false` | suppress؛ لا ترسل عبر session قديمة |

## الإعداد

أسماء backend-only: `EMAIL_PROVIDER`, `RESEND_API_KEY`,
`EMAIL_FROM_ADDRESS`, `ZAMAM_APP_BASE_URL`. يمنع استخدام بادئة `VITE_` لأي secret.
`LocalEmailProvider` يحفظ الرسائل في الذاكرة للاختبار ولا يرسل خارجيًا.

## الاحتفاظ والحذف

- مقترح التنفيذ: inbox لمدة 90 يومًا ثم archive/TTL وفق قرار المؤسسة.
- delivery telemetry يحذف بعد نافذة التشغيل والتحقيق، مع إبقاء audit aggregate.
- حذف العضوية لا يحذف audit؛ يعطل التسليم ويطبق سياسة anonymization المعتمدة.
- لا يعاد استخدام notification أو delivery ID بعد الحذف.

## دليل الاختبار

- `tests/notification-service.test.ts`: dedupe، payload minimization، audience،
  critical override، quiet hours، bounded queries.
- `tests/notification-delivery.test.ts`: digest، locale، retry، DLQ، provider
  contract، idempotency، ومنع الشبكة.
- `tests/notification-ui.test.tsx`: RTL، accessibility، status command،
  provider fail-closed.
