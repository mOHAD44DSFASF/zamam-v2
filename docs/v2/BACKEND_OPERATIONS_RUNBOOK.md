# Backend Foundation: Conventions and Runbook

## API conventions

- Base version: `/v1`.
- Success envelope: `{ data, meta: { correlationId, apiVersion } }`.
- Failure envelope: `{ error: { code, message, details? }, meta }`.
- لا stack traces أو provider errors في public response.
- `x-correlation-id`: من 8 إلى 64 رمزاً؛ يولّد الخادم UUID عند غيابه أو فساده.
- `x-idempotency-key`: إلزامي لكل command؛ من 8 إلى 128 رمزاً.
- `Authorization: Bearer ...`: يتحقق backend مع revocation check.
- `X-Firebase-AppCheck`: إلزامي للواجهات العامة؛ bypass محلي ثابت داخل emulator فقط.
- request JSON أقصاه 16 KiB في foundation endpoint.
- CORS allowlist من `ZAMAM_ALLOWED_ORIGINS`; unknown origins denied.
- `cache-control: no-store`, `nosniff`, و`no-referrer` على الاستجابات.

## Error catalog

`AUTHENTICATION_REQUIRED`, `AUTHORIZATION_DENIED`, `APP_CHECK_REQUIRED`, `CORS_DENIED`, `IDEMPOTENCY_CONFLICT`, `INVALID_REQUEST`, `NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_ERROR`.

## Sample trace

`POST /v1/system/probe` هو command غير تجاري لإثبات المسار: CORS → validation → App Check → revoked-token verification → rate limit → idempotency → outbox → structured log → envelope. اختبار `backend-foundation.test.ts` يثبت replay وعدم تكرار event.

## Staging persistence contract

| السجل | الحقول الأساسية | الكتابة | retention الأولي |
|---|---|---|---|
| `idempotencyKeys/{key}` | operation، fingerprint، actor، status، response، expiresAt | backend transaction فقط | 24 ساعة افتراضياً حسب العملية |
| `outboxEvents/{eventId}` | type/version، tenant، actor، correlation، payload، attempts، availableAt، status | نفس transaction مع business write | حتى completion ثم 30 يوماً؛ dead-letter أطول للتحقيق |

تنفيذ Firestore الفعلي مؤجل إلى P6. يجب أن يكون إنشاء idempotency record وbusiness write وoutbox event ذرياً؛ لا dual write متسلسل.

## Worker policy

- at-least-once delivery مع `event.id` كـ idempotency identity.
- retry أُسّي محدود حتى ساعة، بحد افتراضي 8 محاولات.
- handler مفقود أو استنفاد المحاولات ينتقل إلى dead-letter ولا يُحذف.
- worker logs لا تحتوي payload كاملاً ولا credentials.
- `/health` بلا بيانات حساسة؛ transport الداخلي للأحداث يبقى 503 إلى أن يضاف OIDC verification وpersistent store في P6.

## Local verification

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

لا يوجد deploy command معتمد في هذا milestone. لا تشغّل Firebase deploy أو Cloud Run deploy.

## Operational rollback

1. عطّل route أو event subscription بواسطة configuration flag.
2. اترك outbox records دون حذف لإعادة التشغيل.
3. لا تعدّل business data لتعويض failure قبل فحص idempotency/audit.
4. أعد تشغيل event واحد في staging باستخدام correlation/idempotency IDs غير حساسة.

## أسرار وإعدادات

الأسماء فقط: `ZAMAM_ALLOWED_ORIGINS`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `OPENAI_API_KEY`, `EMAIL_PROVIDER_API_KEY`. تُقرأ الأسرار عبر `SecretProvider`/managed secret binding مستقبلاً، ولا تحفظ في `.env.example` أو Git.
