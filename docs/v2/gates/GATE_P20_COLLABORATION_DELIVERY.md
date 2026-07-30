# Gate P20: Collaboration and Delivery

النتيجة: **PASS** في 2026-07-30. جميع الاختبارات محلية، ولم يحدث اتصال ببيانات
production أو إرسال بريد حقيقي أو deploy.

| البوابة | الدليل القابل للإعادة | النتيجة |
|---|---|---|
| Security | `collaboration-service.test.ts` يعزل internal/client؛ `file-management.test.ts` يمنع download قبل scan؛ `notification-service.test.ts` يصغر payload ويفحص active/access؛ Firestore emulator `5/5` deny-default | PASS |
| Data | file version/checksum/retention states مختبرة؛ `notificationId` و`deliveryId` حتميان؛ replay ينتج dedupe؛ delivery claim يستخدم expected version | PASS |
| Tests | `npm.cmd run check`: 40 files و333 tests؛ P20 focused `14/14`؛ Firestore emulator `5/5` | PASS |
| Performance | file/notification scans بحد 50؛ notification audience بحد 100؛ upload 100MB؛ web entry 12.78KB وأكبر JS 345.83KB | PASS |
| Documentation | `COLLABORATION_VISIBILITY_POLICY.md` و`FILE_SECURITY_AND_OPERATIONS.md` و`NOTIFICATION_EVENT_CHANNEL_MATRIX.md` تتضمن incident/delete/provider runbooks | PASS |
| Secret hygiene | فحص أنماط secrets على repository مع استبعاد generated/lock أعاد صفر ملفات | PASS |

## تحقق End-to-End المنطقي

1. أوامر collaboration/file/review تنشئ outbox داخل نفس المعاملة المدققة.
2. `NotificationProjectionHandler` يستهلك `OutboxEvent` ولا يقبل payload من UI.
3. `NotificationProjectionService` يحل الجمهور، يعيد فحص الوصول، ويكتب
   notification/delivery مصغرين.
4. `NotificationDeliveryJob` يعيد فحص المستخدم، ويجمع digest، ويرسل نصًا عامًا
   فقط عبر provider injected.
5. retry وdead-letter observable، والـidempotency key حتمي.

لا يوجد provider composition فعلي في production ضمن هذا prompt؛ يظل ذلك ضمن
تركيب runtime قبل Prompt 28، ولا يغير نتيجة gate لأن المزود المحلي وعقد Resend
اختبرا دون network.

## شروط STOP

- **Public file path:** غير موجود؛ keys خاصة وopaque.
- **Unscanned download:** مرفوض بواسطة file service.
- **Internal comment/file leakage:** projections منفصلة واختبار payload يثبت عدم
  حفظ نص التعليق واسم الملف.
- **Cross-tenant access:** مرفوض في authorization وFirestore rules.
- **Unknown notification event:** suppressed، ولا ينشئ payload.

## مخاطر مراقبة

- يلزم adapter فعلي لـ delivery store وrecipient directory عند تركيب runtime.
- لا توجد بيانات staging لقياس queue age أو provider throughput؛ اختبار الحمل
  الإلزامي مؤجل إلى Prompt 28.
- retention لمدة 90 يومًا مقترح ويتطلب تأكيد سياسة المؤسسة قبل production.

## قرار المتابعة

**Proceed إلى Prompt 21.** لا يوجد شرط STOP مثبت محليًا.
