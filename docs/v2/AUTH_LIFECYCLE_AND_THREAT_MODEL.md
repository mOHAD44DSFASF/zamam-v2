# دورة المصادقة ونموذج التهديد

## النطاق

هذه الوثيقة تخص Prompt 3. الصلاحيات التفصيلية تأتي في P5؛ لذلك نجاح المصادقة لا يعني امتلاك permission مميزة.

## دورة الجلسة

1. يسجل المستخدم عبر Firebase Authentication من `/login`.
2. يراقب `AuthProvider` حدث `onIdTokenChanged` ولا يقرأ role لتحديد الوصول.
3. يقرأ `sessionViews/{uid}` كـ read model محدود: حالة الحساب وعضويات المؤسسات النشطة فقط.
4. لا يعرض `ProtectedRoute` أبناءه أثناء `loading` أو للحساب anonymous/inactive/error.
5. يفرض backend لاحقاً `verifyIdToken(token, true)` ويقارن `tokenIssuedAt` مع `tokensValidAfter`.
6. عند التعطيل: يحدّث backend الحالة، يعطل identity، ويلغي refresh tokens. تبقى كل privileged request مرفوضة حتى لو لم تحدث UI refresh.
7. logout يستدعي Firebase `signOut` ويمسح session state.

## الدعوة والاستعادة

- `/invitations/accept` يقبل token عالي العشوائية بالشكل فقط في الواجهة؛ التحقق والاستهلاك الذري backend-only.
- idempotency key مطلوب لقبول الدعوة.
- `/password-reset` يعرض نتيجة عامة ثابتة لمنع account enumeration.
- مزود البريد adapter مستقل، وفي local/test يستخدم capture provider ولا يرسل رسالة خارجية.
- لا تنشئ الواجهة user document عند أول login.

## التهديدات والضوابط

| التهديد | الضابط | الدليل |
|---|---|---|
| فتح route قبل اكتمال session | fail-closed loading state | `ProtectedRoute.tsx` واختبار DOM |
| الثقة في role نصي | لا role في `SessionView` ولا قرار route مبني عليه | `auth/types.ts` |
| استمرار disabled session | revoked token verification بكل privileged request | `AuthService.authenticate` |
| account enumeration | public reset response ثابت | `AuthService.requestPasswordReset` |
| replay للدعوة | idempotency + استهلاك backend ذري مقترح لـ P4 | `AcceptInvitationCommand` |
| cross-tenant session | active membership يحمل `organizationId`؛ P5 يتحقق من المورد | `SessionView` وdomain auth |
| self-lockout | منع self-disable | `AuthService.disable` واختباره |
| client-side bypass | admin route مغلق افتراضياً حتى backend authorization | `AdministrationUnavailable.tsx` |

## Emulator

`VITE_USE_FIREBASE_EMULATORS=true` يربط حصراً `127.0.0.1:9099` و`127.0.0.1:8080`. بيانات الاختبار الوهمية في `tests/fixtures/auth/session-views.json`. لا يُفعّل الاتصال تلقائياً في production build.

## متبقٍ لـ P4/P5

- transport فعلي لـ invite/reset/disable.
- Firestore rules لـ `sessionViews`.
- claims/permission evaluation backend-only.
- MFA enrollment والسياسات التنظيمية؛ البنية الحالية MFA-ready ولا تفرضه بعد.
