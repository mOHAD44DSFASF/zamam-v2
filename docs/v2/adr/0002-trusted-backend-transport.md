# ADR-0002: Trusted Backend Transport

- **الحالة:** Accepted
- **التاريخ:** 2026-07-30

## القرار

تُكتب command handlers بعقود Web `Request/Response` مستقلة عن transport، ثم يكيّفها `firebase-adapter.ts` إلى Cloud Functions 2nd gen. تُعالج الأحداث الطويلة في `services/workers` كـ Cloud Run worker مستقل.

## الحدود

- Firebase adapter مسؤول عن token/App Check verification وتحويل transport فقط.
- API core مسؤول عن validation، envelopes، correlation، CORS، rate-limit، idempotency.
- كل business command مستقبلي يمر عبر authorization في P5 وtransactional store في P6.
- الـ in-memory stores الحالية تخص `system.probe` المحلي غير التجاري فقط، ولا يجوز استخدامها في business write أو production scaling.

## النتائج

يمكن اختبار العقود بلا emulator، وتبديل Functions/Cloud Run دون تغيير domain services. يتطلب P6 تنفيذ Firestore transactional idempotency/outbox قبل أول command تجاري.
