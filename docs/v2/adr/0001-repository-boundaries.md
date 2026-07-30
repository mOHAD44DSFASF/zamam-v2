# ADR-0001: Repository Boundaries

- **الحالة:** Accepted
- **التاريخ:** 2026-07-30

## السياق

كان V1 تطبيق React واحداً يحتوي عمليات Firestore مميزة داخل الواجهة. يحتاج V2 إلى فصل واضح يسمح بفرض authorization من backend واختبار قواعد النطاق دون متصفح.

## القرار

استخدام npm workspaces بأربع طبقات:

1. `apps/web` لعرض واجهة المستخدم والطلبات غير الموثوقة.
2. `packages/*` للـ domain، contracts، authorization، config، Firestore adapters، observability.
3. `services/functions` للعمليات الموثوقة المتزامنة.
4. `services/workers` للأحداث والمهام الطويلة والمجدولة.

يُمنع على `packages/domain` استيراد Firebase أو React. ولا تملك الواجهة صلاحية تنفيذ business writes المميزة مباشرة.

## النتائج

- يمكن ترحيل V1 تدريجياً بدلاً من إعادة كتابة فورية.
- تبقى إعدادات TypeScript الصارمة إلزامية للحزم الجديدة.
- يحتفظ تطبيق V1 مؤقتاً باستثناءين `exactOptionalPropertyTypes` و`noUncheckedIndexedAccess` حتى ترحيل نماذجه.
- يتطلب كل boundary عقداً واختباراً قبل الاعتماد عليه من طبقة أخرى.
