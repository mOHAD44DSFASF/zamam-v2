# Autonomous Blockers

## Hard blockers

| ID | النوع | الدليل | شرط الإغلاق |
|---|---|---|---|
| `BLK-003` | External launch | لا legal/privacy/data-residency sign-off ولا `Launch Authority` GO | اعتماد الجهات المسؤولة بعد staging evidence |
| `BLK-004` | External assurance | لا independent penetration ولا production-like load/restore/chaos | تنفيذ الاختبارات في staging معزولة واعتماد نتائجها |
| `BLK-005` | Managed tooling | approval quota يمنع final Git write وbrowser launch حتى 2026-08-05 | إعادة checkpoint وbrowser smoke بعد عودة الصلاحية |

## مخاطر غير مانعة

| ID | الخطر | المعالجة الحالية | شرط الإغلاق |
|---|---|---|---|
| `RISK-001` | وحدة `F:` الأصلية غير متاحة | العمل مستعاد من archive hash-verified في `%TEMP%` | عودة الوحدة ونسخ checkpoints دون الكتابة فوق تغييرات أحدث |
| `RISK-002` | نتيجتا package High لسلسلة React Router؛ لا إصدار متاح من registry يحل كل advisory الحالية معًا | أحدث إصدار متاح مثبت؛ التطبيق لا يستخدم RSC/actions؛ لا deploy | إصدار upstream مصحح، ثم full regression |
| `RISK-004` | مراجعة قانونية إقليمية غير مكتملة | privacy interfaces وافتراضات محافظة | منقول إلى `BLK-003` عند Gate P28 |
| `RISK-006` | audit الإنتاج: 2 High و6 Moderate؛ الكل بلا Critical، وتشمل Google/Firebase transitive | أحدث الإصدارات المباشرة مستخدمة؛ downgrade المقترح من audit غير مقبول؛ الخدمات غير منشورة | تحديث upstream أو mitigation مثبت قبل Gate P28؛ blocker للإطلاق إن بقي High runtime |

## مخاطر مغلقة

| ID | دليل الإغلاق |
|---|---|
| `RISK-003` | emulator config وlocal-only adapters موجودة؛ لا credentials مطلوبة للاختبارات |
| `RISK-005` | JRE 21 محلي معزول؛ `npm run test:emulator` اجتاز 4/4 بعد clean install |
| `BLK-001` | `services/functions/src/api/firebase-adapter.ts` يركب الآن `composeFeatureCommandDispatcher` حقيقي (Firestore-backed AtomicStore/QueryStore/PolicyStore/IdentityResolver) لكل `FEATURE_API_PATHS`؛ 408/408 tests PASS بما فيها `tests/dispatcher-composition.test.ts`؛ التفاصيل والاستثناء الوحيد (`/v1/auth/invitations/accept`، لا منطق موجود بعد) في `docs/v2/P28A_ENDPOINT_COMMAND_MAP.md` |
| `BLK-002` | `services/workers/src/http.ts` يعالج الآن الأحداث فعليًا عبر `dispatchEvent`/`processOutboxEvent` مع `FirestoreEventDeliveryStore` (claim/ack/retry/dead-letter حقيقي)؛ transport محلي حتمي (`LocalWorkerTransportPublisher`) للاختبارات، وPub/Sub حقيقي (`PubSubWorkerTransportPublisher`) للإنتاج مع fail-closed (`assertProductionTransportConfigured`) بلا fallback غير آمن؛ Firestore trigger (`publishOutboxEvent`) يربط outbox الفعلي (المكتوب أصلاً بشكل ذري داخل `AuditCommandService`) بالـtransport؛ 435/435 tests PASS بما فيها `tests/worker-transport.test.ts` (enqueue→ack، retry→success, retry-exhaustion→dead-letter, duplicate-delivery, cross-org isolation, production fail-closed) | مركّبة، مختبرة محليًا؛ نشر Pub/Sub الفعلي وCloud Scheduler يبقى ضمن `BLK-003`/staging |
