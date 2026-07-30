# أمن وتشغيل الملفات

## القرار المعماري

يطبق Prompt 19 القرارات `OD-FIL-01..03` و`OD-INT-01`:

- `PrivateObjectStorage` هو الحد الوحيد بين التطبيق والتخزين.
- `S3CompatiblePrivateStorage` يدعم R2/S3 عبر `S3CompatibleSigner` محقون من composition root. لا يحمل domain ولا React credentials.
- المزود الافتراضي local/emulator. إذا لم تكتمل تهيئة المزود الخارجي، تظهر `FILE_STORAGE_NOT_CONFIGURED` وتبقى الواجهة fail-closed.
- Google Drive غير مستخدم كمخزن أساسي، وV1 `googleDrive.ts` يظل placeholder معطلاً.
- لا يلتزم هذا المستودع بمزود production قبل مقارنة التكلفة والإقامة والامتثال. هذا اختيار deployment وليس تغييرًا للدومين.

لا توجد permanent public URLs. كل تنزيل grant لمدة 300 ثانية، وكل رفع grant لمدة 600 ثانية. مفاتيح objects opaque ولا تحتوي اسم الملف أو البريد أو project title.

## دورة الحياة

1. `prepareUpload`: backend يتحقق من tenant/resource/permission/visibility، اسم الملف، MIME+extension، الحجم حتى 100 MB، وSHA-256. ينشئ `attachment` و`file_version` ذريًا.
2. يصدر المزود signed `PUT` مقيدًا بالمفتاح وMIME والحجم/checksum عند طبقة signer. المتصفح يرفع bytes مباشرة ولا يملك storage credentials.
3. `finalizeUpload`: backend ينفذ HEAD/inspect ويطابق key/size/MIME/checksum. أي اختلاف يبقي النسخة `pending_upload`.
4. النسخة تنتقل إلى `scanning` وتولد `file.scan_requested`.
5. `FileScanHandler` يشغل scanner محليًا في الاختبار أو adapter خارجيًا، ثم يستدعي trusted scan command باستخدام source event كـidempotency.
6. `clean` فقط يجعل النسخة `available`. `infected/error` تصبح `quarantined`. إذا كانت هناك نسخة نظيفة سابقة تبقى latest وقابلة للتنزيل.
7. `download` يعيد فحص aggregate والنسخة (`available + clean`) ويسجل audit قبل إصدار signed `GET`.

## الأنواع والحجم

القائمة الأولى: PDF، JPEG، PNG، WebP، TXT، CSV، DOCX، XLSX، PPTX. يلزم تطابق MIME مع extension، ويعيد scanner التحقق من المحتوى الفعلي/magic bytes. الحد العام 100 MB؛ الأكبر يحتاج مسارًا خاصًا وقرارًا جديدًا، ولا يوجد allow-all.

## العزل والصلاحيات

- كل metadata تحمل `organizationId`، والمفتاح يبدأ بـ`tenants/{organizationId}`.
- `file.upload/version/download/delete/restore` تخضع لنطاق resource.
- internal file يتطلب أيضًا `file.internal.view`.
- Client لا يطلب internal visibility ولا يصل إلا resource مثبت `visibility=client` و`clientAccountId` ضمن عضويته.
- Client يحذف ما رفعه فقط؛ الإدارة تخضع للصلاحية والنطاق.
- `file.scan` و`file.purge` service permissions، و`file.retention.manage` لإدارة legal hold.
- query العميل تفرض `visibility == client`؛ filtering في React ليس حاجزًا.

## الإصدارات

كل bytes immutable في object key جديد. لا تستبدل نسخة قائمة، ولا تصبح النسخة الجديدة latest قبل scan نظيف. النسخة المصابة لا تسقط النسخة النظيفة السابقة. تحفظ النسخ المعتمدة وفق project retention policy؛ الحد الأدنى هو الأدلة المعتمدة. لا تنفذ migration للـlegacy URLs تلقائيًا.

## الحذف والاحتفاظ

- delete هو soft delete لمدة 30 يومًا ويحدد `purgeAfter`.
- restore مسموح قبل `purgeAfter`.
- `legal_hold` يمنع delete/purge.
- purge مرحلتان: `beginPurge` يقفل aggregate كـ`purging` داخل transaction ويولد event؛ worker يحذف objects idempotently ثم `completePurge` يثبت metadata كـ`purged`.
- فشل حذف جزء من objects يعاد؛ المزود يجب أن يعتبر حذف object مفقود نجاحًا.
- لا يحذف Firestore audit أو file-version evidence. تنفيذ anonymization/export يخضع لـ`OD-RET-03`.

## Threat Model

| التهديد | الضابط |
|---|---|
| upload دون auth | trusted API + active membership + scoped permission + App Check/rate limit |
| executable/polyglot | allowlist، size، checksum، quarantine، magic/AV scanner |
| key traversal/PII | object key مولد من IDs validated؛ لا filename |
| public URL leakage | private bucket فقط؛ signed grants قصيرة؛ no URL persistence |
| overwrite/version loss | immutable object keys وpendingVersion lock |
| checksum/size spoofing | signer binding + post-upload inspect |
| client data leakage | resource/visibility/client-account checks وseparate query |
| scan bypass | download يتطلب version `available` و`scanStatus=clean` |
| orphan object | pending upload expiry/reconciliation job؛ metadata/object counts |
| delete race | aggregate `purging` lock وtwo-phase idempotent saga |
| malicious filename/header | normalized displayName، no slashes، quoted disposition sanitized |

## Reconciliation وCleanup

المهام المجدولة المطلوبة:

- كل 15 دقيقة: pending uploads أقدم من ساعة؛ inspect ثم finalize أو cleanup.
- كل ساعة: `scanning` queue age وscanner retry/dead-letter.
- يوميًا: `buildFileCleanupQuery` بحد 25، oldest first، وبدء purge للمستحق.
- يوميًا: مقارنة metadata objectKey مع HEAD للنسخ available؛ mismatch يتحول incident ولا يصحح تلقائيًا.
- أسبوعيًا: inventory objects مقابل `file_version` لاكتشاف orphan؛ quarantine report قبل deletion.

المقاييس: upload prepared/completed/abandoned، bytes، scan latency/verdict، signed grant failures، missing/mismatch/orphan، purge age/failures، downloads denied.

## إعداد البيئة

الأسماء فقط موثقة في `services/functions/.env.example`:

| الاسم | الغرض | الحساسية |
|---|---|---|
| `FILE_STORAGE_PROVIDER` | `local`, `r2`, أو `s3` | غير سري |
| `R2_ACCOUNT_ID`, `R2_BUCKET_NAME` | تعريف حساب/bucket الخاص | backend only |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | توقيع R2 | secrets؛ Secret Manager |
| `MALWARE_SCANNER_PROVIDER`, `MALWARE_SCANNER_ENDPOINT` | اختيار scanner endpoint | backend only |
| `MALWARE_SCANNER_CREDENTIAL_REFERENCE` | مرجع Secret Manager لا القيمة | backend only |

يحظر `VITE_R2_*` وأي storage secret في frontend. لا يسجل logger grants أو keys أو headers.

## Migration من V1

روابط `attachments` و`fileLink` القديمة تعامل كمراجع غير موثوقة:

1. inventory في staging فقط، مع source document ID وURL hash لا URL في التقرير.
2. لا download server-side من URL مجهول قبل allowlist وSSRF controls.
3. metadata لا تصبح available حتى ingest private object، checksum، وفحص clean.
4. المفقود أو public URL غير القابل للاسترداد يوضع quarantine مع سبب.
5. V1 يبقى read-only خلال dual-read المقيّد؛ لا يعاد نشر URL كـsigned grant.

## Runbook

عند ارتفاع scan failures: أوقف finalize consumer، أبق الملفات quarantined، افحص scanner config دون طباعة credentials، وأعد event من dead-letter بمفتاح idempotency نفسه. عند metadata mismatch: امنع التنزيل، سجل incident، ولا تعدل checksum يدويًا. عند credential compromise: أوقف provider feature flag، دوّر secret، أبطل grants حسب إمكان المزود، وراجع audit downloads. لا deploy ولا production migration ضمن هذا Prompt.
