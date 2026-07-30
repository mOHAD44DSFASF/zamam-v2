# ZAMAM V2

منصة عربية لإدارة عمليات الوكالات، قيد التحويل المرحلي من النموذج الأولي V1 إلى بنية V2 موثوقة.

## المتطلبات

- Node.js 24.x
- npm 11.x
- Firebase Emulator Suite عند العمل على طبقة البيانات (لا تستخدم بيانات production محلياً)

## أوامر التطوير

```powershell
npm.cmd install --ignore-scripts
npm.cmd run dev
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run check
```

## بنية المستودع

- `apps/web`: تطبيق React/Vite الحالي ومسار واجهة V2.
- `packages/domain`: نماذج وقواعد النطاق الخالصة.
- `packages/contracts`: عقود API والأحداث والتحقق.
- `packages/authorization`: تقييم الصلاحيات والنطاقات.
- `packages/config`: قراءة الإعدادات والتحقق منها.
- `packages/firestore`: converters ومستودعات Firestore.
- `packages/observability`: logging وcorrelation IDs.
- `services/functions`: واجهة backend الموثوقة القصيرة.
- `services/workers`: المهام غير المتزامنة والمجدولة.
- `docs/v2`: وثائق المنتج والهندسة وقرارات التنفيذ.

## قواعد الأمان المحلية

- لا تُحفظ ملفات `.env` أو القيم السرية في Git.
- استخدم `apps/web/.env.example` للأسماء والصيغ الآمنة فقط.
- لا تعتمد على إخفاء عناصر UI كآلية authorization.
- لا تتصل بخدمات production أو تنشر من مسار التطوير الآلي.

## الحالة

راجع `AUTONOMOUS_PROGRESS.md` للحالة الحالية، و`docs/v2/IMPLEMENTATION_ROADMAP.md` لتسلسل Prompts 2-28.
