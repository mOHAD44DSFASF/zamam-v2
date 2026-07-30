# Client Data and Visibility

## فصل النطاقات

- `Client` هو حساب أعمال داخل Organization.
- `ClientContact` هو سجل اتصال PII؛ وجوده لا ينشئ Auth Identity أو Membership أو Role Assignment.
- `portalStatus=eligible` هو أهلية مدققة فقط، وليس وصولًا.
- Portal invitation/acceptance وClientAdmin approval تؤجل إلى Prompt 27.

## Lifecycle

`lead -> active -> paused -> active`، والأرشفة ممكنة من `lead|active|paused` فقط. لا إعادة فتح بعد `archived` في Prompt 9.

- `client.create`: code فريد داخل tenant.
- `client.manage`: انتقال الحالة.
- `client.contact.manage`: إنشاء Contact، eligibility، portal revoke.
- `client.archive`: يرفض active projects، يعطل contacts، يبطل portal identities، ويحافظ على السجلات.

كل mutation يمر عبر authorization ثم audit/outbox/idempotency transaction.

## PII protection

`ClientContact` يخزن:

- `emailHash`: HMAC-SHA256 keyed ومقيد بـ organization/client.
- `emailCiphertext`: AES-256-GCM مع IV عشوائي وAAD يحوي tenant/client boundary.
- `encryptionKeyVersion`: إصدار المفتاح.

لا يُخزن raw email ولا يظهر في outbox. `AesGcmClientDataProtectionAdapter` في `services/functions/src/client/aes-data-protection.ts` يرفض key غير 32 bytes، key version غير صالح، ciphertext مكسور، وAAD من tenant آخر.

متغيرات البيئة المطلوبة بالاسم فقط:

| الاسم | الغرض |
|---|---|
| `CLIENT_PII_ENCRYPTION_KEY` | مفتاح AES-256 بصيغة base64 من Secret Manager |
| `CLIENT_PII_HASH_KEY` | مفتاح HMAC مستقل بصيغة base64 |
| `CLIENT_PII_KEY_VERSION` | معرف الإصدار الحالي |

لا توجد قيمة افتراضية. Rotation متعدد الإصدارات يلزم قبل production data، ويُستكمل في Prompt 19/28.

## Projections

`projectClientFields` يفصل:

- `summary`: id/name/code/status/industry.
- `internal`: summary + account manager.
- `financial`: internal + financial.

جهات الاتصال لا تدخل Client list؛ query service يفك البريد فقط بعد `client.contact.manage` ويعيد DTO مخصصًا. Client Portal لن يستخدم projection الداخلي.

وفق `OD-CLI-01/02`، Portal يعرض لاحقًا الاسم الأول والدور عند الحاجة و`clientVisible` items فقط. وفق `OD-CLI-03`، ClientAdmin يطلب الدعوة ولا يمنحها مباشرة.

## UI

`ClientManagementPage` يوفر list/detail/search/create client/add contact/eligibility مع loading/error/empty. لا يوجد زر Portal invite، والنص يوضح أن Contact لا يمنح وصولًا. الواجهة تتعامل فقط مع `emailDisplay` من server projection.

## Safety and verification

- client archive محدود إلى 200 Contact؛ الأكبر يستخدم batch workflow.
- `_clientActiveProjectCounts` يمنع الأرشفة مع Project نشط.
- portal provider failure يبقي Contact disabled ويعود `PORTAL_REVOCATION_PENDING`.
- الاختبارات: tenant isolation، uniqueness، encryption roundtrip/AAD، no implicit access، eligibility، revoke، archive، projections، RTL/axe.
- لا KMS حقيقي، production data، portal identity، رسالة، أو deploy في Prompt 9.
