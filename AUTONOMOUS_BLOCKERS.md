# Autonomous Blockers

## Hard blockers

لا يوجد blocker تنفيذي حالي.

## مخاطر غير مانعة

| ID | الخطر | المعالجة الحالية | شرط الإغلاق |
|---|---|---|---|
| `RISK-001` | وحدة `F:` الأصلية غير متاحة | العمل مستعاد من archive hash-verified في `%TEMP%` | عودة الوحدة ونسخ checkpoints دون الكتابة فوق تغييرات أحدث |
| `RISK-002` | نتيجتا package High لسلسلة React Router؛ لا إصدار متاح من registry يحل كل advisory الحالية معًا | أحدث إصدار متاح مثبت؛ التطبيق لا يستخدم RSC/actions؛ لا deploy | إصدار upstream مصحح، ثم full regression |
| `RISK-004` | مراجعة قانونية إقليمية غير مكتملة | privacy interfaces وافتراضات محافظة | blocker للإطلاق فقط قبل P28 |
| `RISK-006` | audit الإنتاج: 2 High و6 Moderate؛ الكل بلا Critical، وتشمل Google/Firebase transitive | أحدث الإصدارات المباشرة مستخدمة؛ downgrade المقترح من audit غير مقبول؛ الخدمات غير منشورة | تحديث upstream أو mitigation مثبت قبل Gate P28؛ blocker للإطلاق إن بقي High runtime |

## مخاطر مغلقة

| ID | دليل الإغلاق |
|---|---|
| `RISK-003` | emulator config وlocal-only adapters موجودة؛ لا credentials مطلوبة للاختبارات |
| `RISK-005` | JRE 21 محلي معزول؛ `npm run test:emulator` اجتاز 4/4 بعد clean install |
