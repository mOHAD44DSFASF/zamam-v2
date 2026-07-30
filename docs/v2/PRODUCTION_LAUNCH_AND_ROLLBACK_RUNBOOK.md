# دليل الإطلاق والرجوع التشغيلي

## حالة هذا المستودع

لم يحدث deploy. قرار Gate 28 الهندسي لا يساوي إذن إطلاق. `Launch Authority` المسمى من المالك وحده يصدر GO بعد إغلاق المتطلبات القانونية والتشغيلية واختبار staging. المسارات غير المركبة تعيد `SERVICE_UNAVAILABLE` ولا تنفذ fallback في React.

## البيئات

1. `local`: Firebase emulators وmock/capture providers فقط.
2. `staging`: مشروع Firebase وR2 buckets وSecret Manager identities منفصلة؛ بيانات مصطنعة أو منزوعة الهوية.
3. `production`: مشروع وحسابات خدمة وأسرار منفصلة؛ لا مشاركة لمفاتيح staging.

لا تُكتب project IDs أو domains أو credentials في Git. الأسماء المطلوبة موثقة في `.env.example` فقط.

## Preflight

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run check
npm.cmd run test:emulator
npm.cmd run package:functions
```

ثم في staging فقط: تحقق من route readiness، indexes، App Check، CORS، MFA للأدوار المميزة، worker IAM، DLQ، provider capture، backup حديث، restore rehearsal، migration dry run، وsynthetic personas. افحص أن `git status` معروف وأن artifact بني من commit معتمد.

`firebase.json` يشغل `npm run check:launch-readiness` قبل packaging. يفشل الفحص عمداً مع أي dispatcher/worker غير مركب، أو عند غياب `ZAMAM_LAUNCH_AUTHORITY_APPROVED=true` و`ZAMAM_STAGING_ASSURANCE_ID` صالح. لا تستخدم bypass؛ أغلق السبب وأعد البوابة.

## مسار الإطلاق المرحلي

1. جمّد schema وworkflow publication مؤقتاً.
2. أنشئ Firestore managed export وسجل checksum/count/cutoff.
3. طبق indexes/rules/backend على staging ثم اختبر.
4. نفذ migration dry run، ثم staging write، ثم reference/tenant/count reconciliation.
5. أنشئ release artifact موقّعاً وسجل commit وconfig version.
6. فعّل production لمجموعة داخلية صغيرة مع `CLIENT_PORTAL_ENABLED=false` و`AI_ENABLED=false`.
7. راقب 24 ساعة، ثم وسّع cohorts تدريجياً.
8. فعّل Portal بعد اختبار disclosure مستقل. AI يبقى proposal-only.

لا ينفذ هذا الدليل تلقائياً ولا يمنح أمراً بـ`firebase deploy`.

## شروط STOP

أي Critical/High قابل للاستغلال، cross-tenant disclosure، migration mismatch، restore failure، unbounded query، missing audit، worker DLQ غير مراقب، App Check/CORS/MFA غير مفعل، أو عدم وجود on-call وowner sign-off.

## Rollback

1. أوقف feature flag/cohort المتأثر؛ لا تحذف outbox أو audit.
2. ارجع Hosting/Functions إلى artifact السابق المسجل.
3. أوقف consumers إذا كان العقد غير متوافق؛ اترك events قابلة لإعادة التشغيل.
4. إذا بدأت migration: أوقف writers، نفذ adapter `rollbackStagingMigration` للمرحلة المدعومة فقط، أو استعد export إلى بيئة بديلة.
5. لا تستخدم rollback destructive فوق production الحالية؛ تحقق counts/references قبل cutover عكسي.
6. ألغ signed grants/sessions عند حادث أمني، ودوّر الأسرار عبر Secret Manager.

## مسؤوليات

Launch Authority: GO/STOP. Tech Lead: artifact/migration. Security: review/incident. Data Owner: reconciliation/retention. On-call: metrics/alerts/DLQ. Support: client communication دون بيانات حساسة.
