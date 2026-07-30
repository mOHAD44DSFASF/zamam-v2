# PROJECT OVERVIEW AND AUDIT - ZAMAM System

> تاريخ الفحص: 2026-07-30  
> نطاق الفحص: جميع ملفات التطبيق والتهيئة والتوثيق والأصول، مع استثناء التحليل العميق للمجلدات المولدة `node_modules/` و`.npm-cache/` وذاكرة Firebase المؤقتة `.firebase/`. تمت معاينة `.agents/` وتصنيفها كأدوات تصميم خاصة بوكلاء التطوير وليست جزءاً من التطبيق وقت التشغيل.  
> قواعد السرية: لا يعرض هذا التقرير أي API key أو password أو token أو project ID أو عنوان خدمة خاص أو بيانات دخول. القيم الموجودة في المصدر موصوفة فقط بوظيفتها ومكانها.  
> حدود مؤكدة: لا توجد `.git/` فعلية في نسخة العمل، ولا توجد قواعد Firebase المنشورة أو كود Cloudflare Worker/Google Apps Script الفعلي، لذلك لا يمكن تأكيد الفرع أو التاريخ أو صلاحيات الإنتاج أو سلوك الخدمات الخارجية.

# 1. Executive Summary

`ZAMAM System` هو تطبيق ويب عربي باتجاه RTL لإدارة فريق وكالة ومهام تمر عبر مراحل عمل متتابعة. المستخدمون المتوقعون هم المدير العام، نائب المدير، المشرفون، والموظفون ذوو الأدوار التنفيذية مثل `Creator` و`Uploader` وأدوار مخصصة.

التطبيق عبارة عن SPA مبني بـReact وTypeScript وVite. لا يوجد backend مملوك للمشروع داخل المستودع؛ المتصفح يتصل مباشرة بـFirebase Authentication وCloud Firestore، ويرسل الملفات إلى Cloudflare R2 Worker خارجي، ويحاول إنشاء مجلدات عبر Google Apps Script.

الميزات المنفذة جزئياً:

- تسجيل الدخول بالبريد وكلمة المرور عبر Firebase.
- إنشاء مستخدمين وتعديل أسمائهم وأدوارهم وتعطيلهم من واجهة الإدارة.
- إنشاء مهام متعددة المراحل، وإسناد كل مرحلة إلى مستخدم أو دور.
- متابعة المرحلة الحالية وإنهاء المهمة.
- رفع مرفقات وإضافة روابط خارجية.
- إنشاء مساحات عمل وتعيين أعضاء ومشرفين.
- لوحات إحصائية أساسية وتحليل أداء أولي.
- نشر SPA على Firebase Hosting وفق `firebase.json`.

الميزات الناقصة أو غير المكتملة:

- حماية المسارات والتحقق الموثوق من الصلاحيات.
- قواعد Firestore/Storage قابلة للمراجعة داخل المستودع.
- الموافقة الإدارية الفعلية رغم وجود `requiresAdminApproval`.
- استعادة كلمة المرور وميزة "تذكرني".
- البحث والإشعارات والأمان وتخصيص الواجهة.
- تكامل Google Drive فعلي؛ العنوان الحالي placeholder والتدفق لا يستخدم OAuth token لإنشاء المجلد.
- حذف ملفات R2 فعلياً، والتحقق من نوع/حجم الملف، وحماية Worker.
- اختبارات التطبيق، مراقبة، نسخ احتياطي، CI/CD، وسياسة rollback.

الحالة الحالية أقرب إلى prototype داخلي قابل للعرض. البناء ينجح، لكن `ESLint` يفشل، توجد ثغرات اعتماديات، ولا يمكن إثبات تفويض قاعدة البيانات. **النتيجة: Not ready for production / غير جاهز للإنتاج، ومناسب فقط لاختبار داخلي مضبوط بعد معالجة حواجز الأمان الفورية.**

# 2. Project Information

| البند | القيمة المؤكدة |
|---|---|
| اسم المشروع | `system` في `package.json`، والاسم التجاري `ZAMAM System` |
| النوع | Client-side SPA لإدارة المهام والفريق |
| اللغات | TypeScript، TSX، JavaScript config، CSS، HTML |
| الإطار | React 19 + React Router 7 + Vite 8 |
| مدير الحزم | npm؛ يوجد `package-lock.json` بإصدار lockfile 3 |
| قاعدة البيانات | Cloud Firestore عبر Firebase Web SDK |
| المصادقة | Firebase Authentication: email/password، ومحاولة ربط Google provider |
| الاستضافة | Firebase Hosting وفق `firebase.json` |
| backend | لا يوجد backend داخل المستودع |
| الفرع الحالي | غير قابل للتأكيد؛ `.git/` غير موجودة |
| Node المفحوص | `v24.14.0`؛ لا يوجد `engines` يفرض نسخة |
| npm المفحوص | `11.9.0` |

الأوامر المعرفة في `package.json`:

| الغرض | الأمر | الحالة |
|---|---|---|
| تثبيت مطابق للقفل | `npm ci` | أمر npm مناسب ومؤكد بوجود lockfile |
| تطوير | `npm run dev` | يشغل Vite |
| بناء | `npm run build` | `tsc -b && vite build` |
| فحص lint | `npm run lint` | يعمل لكنه يفشل حالياً بـ52 خطأ |
| معاينة الإنتاج | `npm run preview` | يشغل `vite preview` بعد وجود `dist/` |
| اختبار | غير موجود | لا script ولا framework اختبارات |
| نشر | غير موجود | لا script؛ Firebase CLI غير مثبت في البيئة |

# 3. Technology Stack

## Frontend

| التقنية | النسخة المقفلة | الغرض | مكان الاستخدام | الإعداد | التقييم |
|---|---:|---|---|---|---|
| React | 19.2.5 | بناء الواجهة | جميع `src/**/*.tsx` | `src/main.tsx` | أساسي |
| React DOM | 19.2.5 | mounting | `src/main.tsx` | لا يوجد إعداد خاص | أساسي |
| React Router DOM | 7.15.0 | المسارات والتنقل | `src/App.tsx` والصفحات | `src/App.tsx` | أساسي، به advisories حالية |
| TypeScript | 6.0.3 | الأنواع والبناء | `src/` | `tsconfig*.json` | أساسي |
| Vite | 8.0.10 | dev/build | المشروع كله | `vite.config.ts` | أساسي، به advisories حالية |

## Backend

لا توجد تقنية backend أو server entry point أو controllers أو API routes داخل المستودع. Firebase والخدمات الخارجية تؤدي هذا الدور من خارج المشروع.

## Database

| التقنية | النسخة | الغرض | مكان الاستخدام | التقييم |
|---|---:|---|---|---|
| Firebase/Firestore SDK | Firebase 12.12.1 | CRUD وrealtime listeners | `src/lib/firebase.ts` والصفحات والمكونات | أساسي؛ schema/rules غير موجودين |

## Authentication

| التقنية | النسخة | الغرض | الملفات | التقييم |
|---|---:|---|---|---|
| Firebase Auth | ضمن 12.12.1 | email/password وGoogle linking | `src/pages/Login.tsx`, `src/components/UserCreationModal.tsx`, `src/pages/AdminDashboard.tsx` | أساسي؛ التفويض ضعيف في الواجهة |

## Styling and UI

| التقنية | النسخة | الغرض | الملفات | التقييم |
|---|---:|---|---|---|
| Tailwind CSS | 4.2.4 | utilities وtokens | `src/index.css`, جميع TSX | أساسي |
| `@tailwindcss/postcss` | 4.2.4 | PostCSS integration | `postcss.config.js` | أساسي |
| Framer Motion | 12.38.0 | animations | الصفحات والمودالات | مستخدم |
| Lucide React | 1.14.0 | icons | الصفحات والمودالات | مستخدم |
| Google Fonts/Cairo | خدمة خارجية | خط عربي | `src/index.css:1` | مستخدم؛ اعتماد شبكي |
| `tailwind.config.js` | n/a | tokens قديمة/مكررة | الجذر | يبدو مكرراً مع `@theme` في Tailwind 4 |

## State Management

لا توجد مكتبة مركزية. الحالة محلية عبر `useState`, `useEffect`, `useMemo`، وFirebase `onSnapshot`. هذا مناسب للحجم الحالي لكنه يربط UI والبيانات والصلاحيات في مكونات ضخمة.

## Validation

لا توجد مكتبة validation. التحقق يعتمد على HTML attributes مثل `required`, `type="email"`, `minLength={6}` وبعض شروط JavaScript. لا توجد schemas مشتركة أو server-side validation ضمن المستودع.

## Testing

لا توجد مكتبة أو إعداد أو ملفات اختبار خاصة بالتطبيق. الاختبارات الموجودة تحت `.agents/skills/**/tests` تخص أدوات الوكلاء وليست ZAMAM.

## External Services

| الخدمة | الحزمة/الآلية | الملفات | التقييم |
|---|---|---|---|
| Firebase Auth/Firestore | `firebase` | `src/lib/firebase.ts` | مستخدم |
| Cloudflare R2 | `fetch` إلى Worker | `src/lib/r2Service.ts` | جزئي وغير قابل للتحقق |
| Google Apps Script/Drive | `fetch` إلى relay | `src/lib/googleDrive.ts` | placeholder/معطل عملياً |
| Google OAuth | Firebase `GoogleAuthProvider` | `src/pages/AdminDashboard.tsx` | جزئي وغير متصل فعلياً بخدمة إنشاء المجلد |

## Deployment and Infrastructure

| التقنية | الملف | الحالة |
|---|---|---|
| Firebase Hosting | `firebase.json`, `.firebaserc`, `.firebase/hosting.*.cache` | إعداد SPA موجود؛ alias في `.firebaserc` غير اعتيادي |
| CORS JSON | `cors.json` | wildcard؛ غير مرتبط تلقائياً بـ`firebase.json` |
| Docker | لا ملفات | غير موجود |
| CI/CD | لا ملفات | غير موجود |

## Development Tools

| التقنية | النسخة المقفلة | الملف | التقييم |
|---|---:|---|---|
| ESLint | 10.3.0 مثبتة مقابل spec `^10.2.1` | `eslint.config.js` | أساسي؛ 52 خطأ |
| typescript-eslint | 8.59.2 | `eslint.config.js` | أساسي |
| Autoprefixer/PostCSS | 10.5.0 / 8.5.14 | `postcss.config.js` | مستخدم؛ PostCSS به advisory |
| `.agents/skills` | عدة أدوات تصميم | `.agents/` | tooling خارجي عن runtime |

حزم production غير مستوردة في `src/`: `@lordicon/react`, `clsx`, `lottie-web`, `tailwind-merge`. تبدو غير مستخدمة حالياً.

# 4. Repository Structure

```text
ZAMAM-main/
├── .agents/                       # Skills وأدوات تصميم للوكلاء؛ ليست جزءاً من runtime
├── .firebase/
│   └── hosting.<cache>.cache      # metadata مولدة من نشر Hosting سابق
├── .npm-cache/                    # cache مولد؛ لا يُحلل
├── node_modules/                  # dependencies مولدة؛ لا تُحلل يدوياً
├── public/
│   ├── favicon.svg                # غير مشار إليه حالياً
│   └── icons.svg                  # غير مشار إليه حالياً
├── src/
│   ├── assets/                    # أصول ZAMAM وملفات template غير مستخدمة
│   ├── components/
│   │   ├── TaskCreationModal.tsx
│   │   ├── UserCreationModal.tsx
│   │   └── UserEditModal.tsx
│   ├── lib/
│   │   ├── firebase.ts            # Firebase app/auth/firestore bootstrap
│   │   ├── googleDrive.ts         # Apps Script relay client
│   │   └── r2Service.ts           # Cloudflare Worker upload client
│   ├── pages/
│   │   ├── AdminDashboard.tsx     # لوحة الإدارة، 1221 سطراً
│   │   ├── EmployeeWorkspace.tsx  # مساحة الموظف، 501 سطر
│   │   └── Login.tsx
│   ├── App.css                    # بقايا Vite template؛ غير مستوردة
│   ├── App.tsx                    # routing
│   ├── index.css                  # Tailwind v4 tokens وRTL
│   ├── main.tsx                   # browser entry
│   └── types.ts                   # نماذج TypeScript جزئية
├── .firebaserc
├── .gitignore
├── cors.json
├── eslint.config.js
├── firebase.json
├── index.html
├── package.json
├── package-lock.json
├── postcss.config.js
├── project_architecture.md
├── README.md
├── tailwind.config.js
├── tsconfig*.json
└── vite.config.ts
```

ملاحظات:

- `README.md` ما زال README افتراضي لـVite ولا يشرح ZAMAM.
- `project_architecture.md` مفيد لكنه لا يذكر `r2Service.ts` في الشجرة، ويقول إن `firebase.ts` يهيئ Storage بينما الكود لا يستدعي `getStorage`.
- `dist/` غير موجود حالياً، رغم وجود cache يشير إلى نشر سابق.
- `vite-dev*.log` ملفات logs مولدة ومُهملة بنمط `*.log`.

# 5. Application Architecture

النمط الفعلي هو **Firebase-backed client SPA**:

1. طبقة عرض React تحتوي أيضاً على orchestration وauthorization وdata access.
2. طبقة `src/lib/` رقيقة لتهيئة Firebase وعميلَي R2/Drive.
3. لا توجد API layer داخلية، service layer متكاملة، repositories، DTOs، أو schema validation.
4. Firestore هو مصدر البيانات، و`onSnapshot` يوفر realtime updates للمهام ومساحات العمل.

فصل المسؤوليات مختلط:

- `AdminDashboard.tsx` يجمع routing داخلي، auth listener، CRUD، الإحصاءات، خمسة views، وأربع modals.
- `EmployeeWorkspace.tsx` يجمع auth، query/filter، تقدم pipeline، uploads، links، archive وUI.
- `TaskCreationModal.tsx` يقرأ Firestore ويرفع إلى R2 ويكوّن model المهمة.

طبقة البيانات:

- لا repository؛ كل مكون يستورد `db` وينفذ Firestore مباشرة.
- لا transactions/batches.
- لا converters أو runtime schemas.
- العلاقات مخزنة كـdocument IDs داخل arrays ولا توجد referential integrity.

إدارة الإعداد:

- Firebase config وعناوين relay hardcoded في `src/lib/*.ts`.
- لا `.env` أو `.env.example`.
- لا فصل dev/staging/prod.

معالجة الأخطاء:

- خليط من `console.error`, `alert`, `window.confirm`, toast وmodal alert.
- بعض `onSnapshot` لا تملك error callback؛ `try/catch` الخارجي لا يلتقط أخطاء listener غير المتزامنة.
- لا error boundary ولا logging/monitoring مركزي.

النتيجة: architecture مختلطة وغير متسقة، مناسبة لنموذج أولي لا لتوسع آمن.

# 6. Application Entry Points

## Frontend initialization

1. `index.html` يعرّف `<div id="root">` ويحمّل `/src/main.tsx`.
2. `src/main.tsx:6-10` ينشئ React root داخل `StrictMode`.
3. `src/App.tsx:9-17` ينشئ `BrowserRouter`.
4. React Router يختار إحدى الصفحات الثلاث.
5. الصفحة نفسها تسجل Firebase auth listener وتقرأ البيانات.

## Routing entry

| route | component | fallback |
|---|---|---|
| `/` | `Login` | نقطة الدخول |
| `/admin` | `AdminDashboard` | لا route guard |
| `/workspace` | `EmployeeWorkspace` | لا route guard |
| `*` | `<Navigate to="/" replace />` | يعيد إلى login |

## Firebase bootstrap

`src/lib/firebase.ts`:

1. يهيئ default Firebase app من config hardcoded.
2. يصدر `auth` و`db`.
3. يهيئ `SecondaryApp`.
4. يصدر `secondaryAuth` لإنشاء مستخدم دون تغيير جلسة المدير الأساسية.

لا توجد entry points لـbackend/server/API/worker/jobs/cron/webhook. كود Worker وApps Script الظاهر هو مثال داخل comments فقط وليس artifact قابل للنشر من هذا المستودع.

# 7. Features and Modules

| الميزة | غرض المستخدم | الحالة | الملفات والبيانات | القيود/العمل الناقص |
|---|---|---|---|---|
| Login | دخول المستخدم | Partial | `Login.tsx`; Auth + `users` | reset وremember غير منفذين؛ role write من العميل |
| Admin dashboard | ملخص وإدارة | Partial | `AdminDashboard.tsx`; كل collections | لا حماية route موثوقة، widgets غير دقيقة |
| Task creation | إنشاء وتوجيه مهمة | Partial | `TaskCreationModal.tsx`, `tasks` | validation ضعيف، `createdBy` مفقود، approval غير منفذ |
| Pipeline progression | انتقال بين مراحل | Partial | `EmployeeWorkspace.handleMarkDone` | لا تحديث لحالة stages ولا audit trail ولا approval |
| Team management | إضافة/تعديل/تعطيل | Partial | `UserCreationModal`, `UserEditModal`, `users` | التعطيل لا يعطل Auth، لا reset/verify |
| Role management | أدوار مخصصة | Partial | `AdminDashboard.tsx`, `roles` | حذف بلا فحص مراجع، defaults ناقصة |
| Workspaces | تجميع أعضاء ومهام | Partial | `AdminDashboard`, `TaskCreationModal`, `workspaces` | حذف يترك tasks يتيمة، لا validation للعلاقات |
| Employee workspace | تنفيذ المهام | Partial | `EmployeeWorkspace.tsx`, `tasks` | client filtering، archive يكشف كل المكتمل إذا سمحت rules |
| Attachments | رفع ملفات/روابط | Partial/Unclear | `r2Service.ts`, `EmployeeWorkspace`, `TaskCreationModal` | Worker غير موجود، لا حذف object ولا limits |
| Google Drive | إنشاء مجلد لكل مهمة | Broken/Placeholder | `googleDrive.ts`, `AdminDashboard.connectDrive` | relay placeholder، OAuth غير مستخدم للطلب |
| Analytics | أداء أعضاء | Placeholder/Partial | `AdminDashboard.AnalyticsView` | متوسط الوقت ثابت، "هذا الشهر" يحسب كل المهام |
| Search | البحث | Placeholder | input في `AdminDashboard.tsx:921-924` | لا state ولا filtering |
| Notifications | تنبيهات | Placeholder | Bell UI وsettings card | لا بيانات أو service |
| Security settings | إعدادات الأمان | Placeholder | `SettingsView` | يعرض رسالة "تحديث قادم" فقط |
| UI customization | تخصيص | Placeholder | `SettingsView` | غير منفذ |
| Responsive RTL | واجهة عربية | Mostly Complete | `index.html`, `index.css`, جميع الصفحات | accessibility ضعيفة |

# 8. User Roles and Permissions

الأدوار الظاهرة في الكود:

- `Admin`: المدير العام.
- `DeputyManager`: نائب المدير.
- `Manager`: مشرف.
- `Reviewer`, `Uploader`, `Creator`.
- أدوار ديناميكية `custom_role_<timestamp>`.

`Role` معرف كـ`string` في `src/types.ts:3`، لذلك لا توجد type safety فعلية.

## Login flow

1. `Login.handleLogin` يستدعي `signInWithEmailAndPassword`.
2. يقرأ `users/{uid}`.
3. إذا `isDeleted === true` يسجل الخروج.
4. إذا كان البريد يساوي قيمة privileged hardcoded، يكتب role `Admin` من العميل. القيمة نفسها محجوبة من التقرير.
5. إذا لم يوجد user document، ينشئه تلقائياً بدور `Creator` أو `Admin` للحساب privileged.
6. `Admin/DeputyManager/Manager` ينتقلون إلى `/admin`، والباقي إلى `/workspace`.

## Registration

لا تسجيل عام. `UserCreationModal.handleSubmit` ينشئ حساب Email/Password عبر `secondaryAuth` ثم يكتب profile ودوره إلى `users/{uid}`. التنفيذ كله من المتصفح.

## Password reset

غير منفذ. الرابط في `Login.tsx:167` هو `href="#"`.

## Session

لا يوجد إعداد persistence صريح ولا إدارة token صريحة؛ Firebase Auth SDK يدير الجلسة وفق default browser behavior. لا claims مخصصة في الكود.

## Authorization checks

- `App.tsx` لا يحمي routes.
- `AdminDashboard` يتحقق من وجود Firebase user فقط، ولا يرفض role غير إداري.
- إخفاء بعض menu items يعتمد على `userRole !== 'Manager'`.
- فلترة manager لمساحات العمل والمهام تتم في الذاكرة بعد تحميل collections.
- `EmployeeWorkspace` يحمل collection `tasks` كاملة ثم يفلترها client-side.
- لا يمكن تأكيد enforcement الحقيقي لأن Firestore rules غير موجودة في المستودع.

نقاط الضعف:

- أي مستخدم authenticated يمكنه فتح `/admin` وتجربة عمليات الإدارة من UI.
- client-side checks لا تمثل تفويضاً أمنياً.
- الموظف المحذوف لا يُعطل في Firebase Auth، والجلسة المفتوحة لا تراقب `isDeleted`.
- archive يعرض كل completed tasks لكل دور غير إداري لأن شرط archive يسبق فحص الإسناد.
- لا email verification، MFA، password policy مخصصة، أو force-change للـtemporary password.

# 9. Frontend Analysis

## الصفحات

| Route | الغرض | Component | مصدر البيانات | Auth مطلوب فعلياً | الحالة | أهم المشكلات |
|---|---|---|---|---|---|---|
| `/` | login | `Login` | Firebase Auth + `users` | لا | Partial | reset/remember placeholders |
| `/admin` | الإدارة | `AdminDashboard` | Auth + `users`, `tasks`, `roles`, `workspaces`, `settings` | authenticated فقط داخل effect | Partial | لا role guard؛ ملف ضخم |
| `/workspace` | مهام الموظف | `EmployeeWorkspace` | Auth + `users`, `tasks` | authenticated داخل effect | Partial | query كاملة وclient filtering |
| `*` | fallback | `Navigate` | لا شيء | لا | Complete | يعيد إلى `/` |

## State and communication

- local state فقط؛ لا Context/Redux/Zustand/query cache.
- Firestore realtime للمهام ومساحات العمل.
- users/roles يقرآن عبر one-shot `getDocs`.
- uploads وDrive يستخدمان `fetch` مباشرة.

## Forms and validation

- Login: `type=email`, `required`; لا trimming أو schema.
- Create user: name/email/password/role؛ password مرئي `type="text"` و`minLength=6`.
- Create task: title required فقط؛ لا limits للوصف أو stages أو attachments.
- Workspace: الاسم required؛ arrays بلا منع duplication.
- Link: `type=url`; لا allowlist للـprotocol/domain.

## UI states

- loading موجود في login/user creation/edit/uploads.
- empty states موجودة للمهام والفريق/workspaces/archive.
- error states خليط وغير موحد.
- لا skeletons ولا retry controls.

## Responsive/RTL

- `dir="rtl"` في `index.html` و`direction: rtl` في `index.css`.
- desktop sidebar وmobile bottom nav موجودان.
- grids responsive.
- لا i18n framework؛ النصوص العربية hardcoded.

## Accessibility

فحص المصدر لم يجد `aria-*`, `htmlFor`, dialog roles، focus management أو keyboard handlers:

- كثير من labels غير مرتبطة بالـinputs.
- icon-only buttons غالباً بلا accessible name.
- modals لا `role="dialog"` ولا `aria-modal` ولا focus trap/Escape.
- cards قابلة للنقر عبر `<div onClick>` في settings وليست keyboard accessible.
- toast لا `aria-live`.

## Duplication and complexity

- `AdminDashboard.tsx`: 1221 سطر و26 استخداماً لـ`any`.
- `EmployeeWorkspace.tsx`: 501 سطر و9 استخدامات لـ`any`.
- markup المرفقات متكرر بين active/archive.
- mapping users يتكرر في `AdminDashboard.tsx:971-1009`.
- tokens مكررة في `tailwind.config.js` و`src/index.css`.

## Hardcoded/placeholder UI

- search input بلا وظيفة.
- bell indicator ثابت.
- team status دائماً "متصل".
- analytics average ثابت `0 يوم`.
- system version/developer/update date hardcoded.
- security/notification/UI settings placeholders.

# 10. Backend Analysis

**لا يوجد backend داخلي.** لا routes أو controllers أو services server-side أو middleware أو models أو repositories أو rate limiting أو cache أو queues أو jobs.

## API/remote-operation table

| Method/SDK operation | Endpoint/target | الغرض | Auth | الطلب | الاستجابة | Handler | Collection/service | Validation | المشاكل |
|---|---|---|---|---|---|---|---|---|---|
| Firebase SDK `signIn` | Firebase Auth managed endpoint | login | email/password | email, password | Firebase user credential | خارجي | Auth | SDK فقط | لا MFA/verification محلي |
| Firestore SDK CRUD/listen | managed Firestore | بيانات التطبيق | Firebase token حسب rules | docs/queries | snapshots/docs | خارجي | 5 collections | لا schema | rules غير موجودة |
| Firebase SDK `createUser` | Firebase Auth | إنشاء موظف | ينفذ من secondary client | email/password | user credential | خارجي | Auth + `users` | minLength 6 فقط | لا privileged backend |
| POST | `${R2Service.uploadUrl}/upload`؛ القيمة محجوبة | رفع ملف | لا auth في client | multipart file + taskId | `{success,url}` متوقع | Worker غير موجود | R2 | لا size/type/count | CORS/auth/delete غير موثقة |
| POST | `GoogleDriveService.relayUrl`؛ القيمة placeholder ومحجوبة | إنشاء مجلد | لا token في الطلب | JSON action/name كنص | folder id/url متوقع | Apps Script غير موجود | Drive | اسم فقط | placeholder وpublic-share sample |

لا توجد response conventions مشتركة. R2/Drive يتوقعان shape غير typed بالكامل، ويحوّلان معظم الأخطاء إلى `{success:false}`.

# 11. Database Analysis

التقنية: Cloud Firestore. لا schema أو migrations أو seed scripts أو emulator config أو rules أو indexes داخل المستودع.

| Entity/collection | الغرض | الحقول المهمة المستنتجة | العلاقات | الميزات | المصدر |
|---|---|---|---|---|---|
| `users` | profile/role | document ID=Auth UID، `uid?`, `displayName`, `email`, `role`, `createdAt`, `updatedAt`, `isDeleted` | role -> `roles/{id}` | login/team/workspaces | Login + user modals |
| `roles` | تعريف الأدوار | document ID=role ID، `name`, `isSystem` | referenced by users/pipeline | role management | Admin + modals |
| `tasks` | المهمة/pipeline | `title`, `description`, `priority`, `status`, `pipeline[]`, `currentStage`, `requiresAdminApproval`, `requiresFileUpload`, `attachments[]`, `fileLink`, `driveFolderId`, `workspaceId`, `createdAt`, `completedAt` | workspace/user/role IDs | task flow | task modal + pages |
| `workspaces` | تجميع فريق | `name`, `members[]`, `supervisors[]`, `createdBy`, `createdAt`, `updatedAt` | user IDs | workspace management | Admin |
| `settings/general` | إعداد global | `isDriveConnected` | لا شيء | Drive settings | Admin |

## Data integrity

- لا primary/foreign keys رسمية سوى document IDs.
- لا unique constraints داخل Firestore موثقة.
- uniqueness للبريد يديرها Firebase Auth، لا collection.
- لا indexes مخصصة موجودة؛ queries الحالية بلا filters/order ولذلك قد تعمل بالـdefault indexes.
- `users.createdAt` قد يكون Timestamp أو ISO string حسب مسار الإنشاء.
- `updatedAt` في user modal ISO string، بينما workspace timestamps تُكتب كـDate/Timestamp.
- `tasks.completedAt` ISO string، و`createdAt` Timestamp بعد Firestore serialization.
- `Task.createdBy` موجود في TypeScript interface لكنه لا يُكتب عند إنشاء المهمة.
- حذف workspace/role hard delete ولا ينظف المراجع.
- user soft delete لا يغير Auth account.
- حذف attachment يزيل metadata فقط ولا يحذف R2 object.
- stage `status` يبقى `Pending` دائماً.

لا يمكن القول إن migrations وschemas synchronized لأنها غير موجودة أصلاً.

# 12. Data Flow and Main Workflows

## Login

1. المستخدم يرسل form في `Login.handleLogin`.
2. Firebase Auth يتحقق من credentials.
3. الصفحة تقرأ `users/{uid}`.
4. الحساب soft-deleted يُخرج.
5. profile missing يُنشأ client-side.
6. role يحدد `/admin` أو `/workspace`.
7. الأخطاء تحول إلى ثلاث رسائل عامة، مع logging في console.

المخاطر: role mutation client-side، لا password reset، ونجاح التفويض يعتمد كلياً على rules الخارجية.

## Create user

1. Admin يفتح `UserCreationModal`.
2. المودال يقرأ كل `roles`.
3. `createUserWithEmailAndPassword(secondaryAuth, ...)`.
4. `setDoc(users/{uid})` يكتب الاسم والبريد والدور وtimestamp string.
5. parent يعيد قراءة `users`.

فشل Auth بعد نجاح Firestore أو العكس غير معالج transactionally. لا rollback للحساب إذا فشل profile write.

## Create task

1. Admin يفتح `TaskCreationModal`.
2. المودال يقرأ `roles` و`workspaces`.
3. المستخدم يبني pipeline ويختار assignees.
4. المرفقات الاختيارية ترفع فوراً إلى R2 تحت `temp_uploads`.
5. `handleSubmit` يكوّن object.
6. إن كانت حالة Drive global true، يحاول `GoogleDriveService.createFolder`.
7. `addDoc(tasks, finalData)`.
8. listener يحدّث الواجهة؛ الكود يقوم أيضاً بـ`getDocs(tasks)` redundantly.

الأخطاء: الملفات قد تصبح orphan عند الإلغاء/الفشل، `createdBy` مفقود، لا validation للمراحل، وDrive failure لا يمنع المهمة ولا يظهر warning واضح.

## Progress task

1. `EmployeeWorkspace` يحمّل كل tasks ثم يفلترها.
2. الموظف ينقر إتمام.
3. إن كان `requiresFileUpload` يتحقق client-side من attachments أو `fileLink`.
4. يحسب `nextStage=currentStage+1`.
5. يكتب `currentStage` و`In Progress`، أو `Completed` و`completedAt`.
6. realtime snapshot يحدّث القائمة.

لا admin approval، لا stage status/history، لا transaction تمنع double-click/race، ولا تحقق server-side من هوية المنفذ.

## Upload/delete attachment

1. الملفات تُرسل بالتوازي إلى Worker.
2. URLs الناتجة تضاف بـ`arrayUnion`.
3. delete يقرأ task، يفلتر URL، ثم يكتب array كاملة.
4. R2 object لا يُحذف.

مشاكل: unbounded parallelism، race في delete read-modify-write، لا file constraints، ولا cleanup.

## Add link

1. modal يجمع name وURL.
2. يضيف object بـ`arrayUnion`.
3. UI يعرضه في `<a target="_blank" rel="noopener noreferrer">`.

لا protocol/domain allowlist؛ يجب السماح بـHTTPS الموثوق فقط.

## Workspaces

1. Admin يحدد name/members/supervisors.
2. `addDoc` أو `updateDoc`.
3. `onSnapshot` يحدث cards.
4. tasks تربط اختيارياً عبر `workspaceId`.
5. manager يرى client-filtered workspaces التي تتضمن UID كمشرف.

الحذف يترك `tasks.workspaceId` يشير إلى document غير موجود.

## Role management

1. عند collection فارغة، `fetchRoles` يزرع 4 defaults من client.
2. الدور المخصص يحصل على ID timestamp.
3. الحذف hard delete إذا `isSystem=false`.

لا تحقق من users/tasks التي ما زالت تشير للدور، ولا transaction أو server authority.

# 13. External Integrations

| الخدمة | الغرض | الملف/الحزمة | متغيرات البيئة الحالية | auth | الحالة | error/retry/rate/webhook | المخاطر |
|---|---|---|---|---|---|---|---|
| Firebase Auth | login/create/link Google | `firebase`; `src/lib/firebase.ts` | لا يوجد؛ config hardcoded | Firebase token | مستخدم | SDK errors؛ لا retry مخصص؛ لا webhook | authorization rules غير ممثلة |
| Cloud Firestore | بيانات realtime | `firebase` | لا يوجد | Firebase token + deployed rules | مستخدم | console/alerts؛ لا retry مخصص | rules/schema غير موجودة |
| Cloudflare R2 Worker | uploads | `fetch`; `src/lib/r2Service.ts` | لا يوجد؛ URL hardcoded | لا header/token من client | Unable to verify | لا retry/rate/webhook/delete | upload abuse، public URLs، no limits |
| Google Apps Script | create folder | `fetch`; `googleDrive.ts` | لا يوجد؛ placeholder URL | لا token في الطلب | Broken/Placeholder | catch -> false؛ لا retry | sample public sharing وunauthenticated relay |
| Google OAuth via Firebase | link account | `GoogleAuthProvider` | Firebase config hardcoded | OAuth popup | Partial | بعض error branches؛ branch مكرر | حالة connected global ومضللة |
| Google Fonts | Cairo | CSS import | لا يوجد | لا | مستخدم | browser fallback فقط | privacy/performance/CSP |

لا email/SMS/WhatsApp/payment/AI/analytics/notification providers، ولا webhooks أو background automation.

# 14. Environment Variables and Configuration

لا توجد ملفات `.env`, `.env.example` ولا أي مراجع إلى `import.meta.env` أو `process.env`. لذلك **عدد environment variables المطلوبة فعلياً في الكود الحالي هو صفر**؛ بدلاً منها توجد قيم hardcoded.

## متغيرات موصى بها وليست مطبقة حالياً

| الاسم المقترح | الغرض | الملف الحالي | side | required بعد الترحيل | example آمن |
|---|---|---|---|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase web config | `src/lib/firebase.ts` | frontend | نعم | `example-public-web-key` |
| `VITE_FIREBASE_AUTH_DOMAIN` | auth domain | نفس الملف | frontend | نعم | `project.example.invalid` |
| `VITE_FIREBASE_PROJECT_ID` | project identifier | نفس الملف | frontend | نعم | `example-project` |
| `VITE_FIREBASE_STORAGE_BUCKET` | bucket name | نفس الملف | frontend | اختياري حالياً | `example.invalid` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | messaging config | نفس الملف | frontend | حسب Firebase | `000000000000` |
| `VITE_FIREBASE_APP_ID` | app identifier | نفس الملف | frontend | نعم | `example-app-id` |
| `VITE_R2_UPLOAD_URL` | Worker base URL | `src/lib/r2Service.ts` | frontend | نعم للرفع | `https://upload.example.invalid` |
| `VITE_GOOGLE_DRIVE_RELAY_URL` | Apps Script relay | `src/lib/googleDrive.ts` | frontend | نعم للتكامل | `https://relay.example.invalid` |

مهم: متغيرات `VITE_*` تظهر للمتصفح وليست مكاناً لأي secret. Firebase web config عادة public identifier، لكن يجب تقييد المشروع والـAPI واستخدام rules. أي R2 credentials أو service-account keys يجب أن تبقى server-side/Worker secrets ولا تحمل prefix `VITE_`.

مشكلات config:

- لا فصل environments.
- relay URLs hardcoded، وأحدها placeholder مؤكد.
- `.firebaserc` يستخدم alias باسم غير اعتيادي بدلاً من `default`; يحتاج تأكيد owner.
- `cors.json` يسمح `origin: "*"` وطرق متعددة وAuthorization.
- لا security headers/CSP في `firebase.json`.

# 15. Installation and Local Development

تعليمات مؤكدة من الملفات:

1. تثبيت Node.js وnpm. لا توجد نسخة مفروضة؛ الفحص نجح على Node 24.14.0 وnpm 11.9.0.
2. من root: `npm ci`.
3. لا توجد environment setup حالية؛ config hardcoded.
4. لا setup محلي لقاعدة البيانات أو Firebase emulator.
5. لا migrations.
6. لا seed command؛ `fetchRoles` يزرع defaults تلقائياً عند فتح الإدارة إذا كانت `roles` فارغة.
7. التطوير: `npm run dev`.
8. الاختبارات: لا أمر.
9. lint: `npm run lint`، ويفشل حالياً بـ52 error.
10. الإنتاج: `npm run build`.
11. المعاينة: `npm run preview`.
12. production start server: غير موجود؛ الناتج static في `dist/`.

نتائج التحقق:

- TypeScript app/node configs مع `--noEmit --incremental false`: نجاح.
- Vite production build إلى temp: نجاح.
- output: JS minified نحو 808.88KB (gzip 242.16KB)، CSS 72.83KB (gzip 12.33KB).
- Vite حذر من chunk أكبر من 500KB.
- لا يمكن التحقق من deploy لأن Firebase CLI غير موجود ولا deploy script.

# 16. Deployment and Infrastructure

`firebase.json` يحدد:

- public directory: `dist`.
- تجاهل dotfiles و`node_modules`.
- rewrite كل المسارات إلى `/index.html` لدعم SPA routes.

`.firebase/hosting.*.cache` يثبت وجود metadata لنشر سابق، لكنه لا يثبت البيئة الحالية أو نجاح آخر نشر. `dist/` غائب.

غير موجود:

- Dockerfile/Compose.
- reverse proxy.
- CI/CD.
- health check.
- monitoring/log aggregation.
- backup/restore policy.
- rollback/versioning strategy.
- staging environment.
- Firebase rules/index deployment config.

قاعدة البيانات مستضافة خارجياً في Firebase وفق client config، وR2/Apps Script خارج المستودع. Domains/callbacks الفعلية غير موثقة ولن يعرضها التقرير.

مخاوف الإنتاج:

- لا artifact promotion أو reproducible deploy workflow موثق.
- `.firebaserc` alias يحتاج إصلاح/تأكيد.
- لا headers مثل CSP, HSTS configuration, X-Content-Type-Options ضمن Hosting config.
- لا source maps policy موثقة.
- لا backups أو data export.

# 17. Testing and Quality Assurance

لا توجد اختبارات unit/integration/e2e ولا coverage أو mocking.

| Workflow | الخطر | التغطية الحالية | النوع المطلوب | الأولوية |
|---|---|---|---|---|
| Auth + route authorization | Critical | صفر | integration + rules emulator + e2e | P0 |
| Firestore security rules | Critical | غير موجودة | Firebase emulator rules tests | P0 |
| Pipeline progression/approval | High | صفر | unit + integration + concurrency | P0 |
| User create/edit/delete | High | صفر | integration + rollback cases | P1 |
| R2 upload validation/delete | High | صفر | contract + security + e2e | P1 |
| Workspace/role referential integrity | High | صفر | integration | P1 |
| Login reset/session/logout | Medium | صفر | e2e | P1 |
| Analytics calculations | Medium | صفر | unit | P2 |
| Responsive/accessibility | Medium | manual فقط | axe + Playwright visual/e2e | P2 |
| Production build/deploy | High | build يدوي فقط | CI smoke/deploy preview | P1 |

نتيجة lint: 52 errors؛ 48 منها `no-explicit-any`، والباقي effect state update، duplicate branch، `prefer-const`، وimpure `Date.now()` during render.

# 18. Security Audit

| Severity | الملف/الموضع | المشكلة | الأثر المحتمل | الإصلاح الموصى به |
|---|---|---|---|---|
| Critical | لا يوجد `firestore.rules`/`storage.rules` | لا يمكن مراجعة أو نشر authorization policy من repo | لا يمكن إثبات حماية كل البيانات/الكتابات | أضف rules deny-by-default واختبارات emulator وضمها للنشر |
| High | `src/App.tsx:11-15`, `AdminDashboard.tsx:79-147` | `/admin` لا يتحقق من role | مستخدم authenticated يصل إلى UI وعمليات الإدارة؛ نجاح الكتابة يعتمد على rules | `ProtectedRoute` + server/rules role enforcement |
| High | `EmployeeWorkspace.tsx:57-70` | تحميل كل tasks وفلترة client-side؛ archive يعيد كل completed قبل فحص الإسناد | كشف مهام ومرفقات إذا سمحت rules بالlist | queries مقيدة + rules document-level + archive ownership filter |
| High | `UserCreationModal.handleSubmit`, `Login.handleLogin` | إنشاء profile/تعيين role من العميل، مع privileged-email rule hardcoded | privilege escalation إذا rules غير صارمة | Admin backend/Cloud Function + custom claims + منع client role writes |
| High | `r2Service.ts:62-97`, `TaskCreationModal.handleFileUpload`, `EmployeeWorkspace.handleFileUpload` | upload بلا client auth/header أو size/type/count limits؛ Worker غير موجود للمراجعة | abuse، malware، cost/DoS، data exposure | signed uploads، Worker auth، limits، MIME sniffing، quotas، malware scan |
| High | dependency tree | `npm audit` بتاريخ الفحص: 5 production findings تشمل 1 critical و3 high و1 low | مخاطر في Firebase transitive وReact Router | تحديثات مدروسة واختبارات، خصوصاً Firebase/Router |
| Medium | `AdminDashboard.deleteTeamMember` + auth effects | soft delete لا يعطل Auth ولا يقطع الجلسة | مستخدم مع جلسة مفتوحة قد يستمر حسب rules | Admin SDK disable/revoke tokens + rules check `isDeleted` |
| Medium | `Login.tsx:44-48` | بريد إداري hardcoded يغير role من client | business rule مكشوف وهش | custom claims/bootstrap server-side؛ إزالة literal |
| Medium | `UserCreationModal.tsx:115` | temporary password يظهر في input text | كشف بصري/تسجيل شاشة | `type=password` + invite/reset flow + force change |
| Medium | `EmployeeWorkspace.handleAddLink` وروابط task | لا allowlist للـURL protocol/domain | malicious links أو scheme abuse | parse URL واسمح HTTPS/domains محددة |
| Medium | `cors.json` | wildcard origin وmethods واسعة | توسيع سطح الاستدعاء إن طُبق على storage/service | origins محددة وأقل methods/headers |
| Medium | `firebase.json` | لا security headers/CSP | XSS impact أعلى وclickjacking | أضف CSP وframe-ancestors وnosniff وreferrer policy |
| Medium | `googleDrive.ts` sample + `connectDrive` | relay sample بلا request auth ويجعل folder anyone-with-link | إنشاء folders غير مصرح وتسريب محتوى | authenticated backend، least privilege، private-by-default |
| Low | عدة catch blocks | `console.error` و`error.message` للمستخدم | كشف تفاصيل تنفيذ | logging منظم ورسائل آمنة |

فحوص أخرى:

- لا SQL؛ SQL injection غير منطبق.
- لا shell execution؛ command injection غير ظاهر.
- لا server URL fetch من user input؛ SSRF غير موجود في هذا repo، لكن Worker الخارجي غير قابل للفحص.
- React escaping يقلل XSS النصي، ولا يوجد `dangerouslySetInnerHTML`.
- روابط `target="_blank"` تستخدم `rel="noopener noreferrer"` بشكل صحيح.
- CSRF التقليدي أقل انطباقاً على Firebase token calls، لكن dependency audit وجد React Router advisories؛ استخدام المشروع الحالي declarative SPA قد يقلل بعض المسارات المتأثرة ولا يلغي ضرورة التحديث.
- Firebase web config hardcoded ليس secret server-side بحد ذاته، لكن القيم لم تُكرر هنا ويجب حمايتها بالـrules والقيود.

# 19. Performance Audit

## مشاكل مؤكدة

| المشكلة | الدليل | الأثر | التوصية |
|---|---|---|---|
| صور ضخمة | assets مستخدمة: نحو 10.6MB + 3.56MB + 0.89MB | تحميل أولي بطيء | WebP/AVIF وأبعاد مناسبة وresponsive images |
| bundle كبير | Vite: JS 808.88KB minified | startup/parse بطيء | route-level lazy loading وتقسيم Firebase/UI |
| full collection listeners | Admin وEmployee `query(collection(db,'tasks'))` | bandwidth/memory يتزايدان بلا حد | Firestore `where`, `orderBy`, `limit`, pagination |
| client filtering | `EmployeeWorkspace.tsx:57-72` | كل البيانات تصل قبل الفلترة | query حسب role/assignee/status مع data model مناسب |
| redundant refetch | `AdminDashboard.tsx:952-956` بعد listener | قراءة وفاتورة إضافية | الاعتماد على listener أو optimistic update |
| O(members*tasks*pipeline) | dashboard stats/assignee counts | rerender مكلف | precomputed metrics/memoized indexes/server aggregation |
| unbounded uploads | `Promise.all(Array.from(files))` | network/memory spikes | max count/size وconcurrency queue |
| giant eagerly loaded pages | imports مباشرة في `App.tsx` | لا code splitting | `React.lazy` لكل route |
| unused large assets/files | عدة PNG/SVG و`App.css` | repo/build maintenance؛ غير المستخدمة لا تدخل bundle غالباً | إزالة بعد تأكيد owner |

## مشاكل محتملة تحتاج قياس

- عدم وجود composite indexes ليس عائقاً حالياً لأن queries بسيطة؛ سيصبح ضرورياً بعد server-side filtering.
- Firestore offline cache غير مهيأ صراحة.
- no caching headers مخصصة في Firebase Hosting.
- Google Font network may block font rendering؛ يحتاج measurement/self-host decision.
- realtime listeners cleaned up بشكل صحيح، لذلك لا memory leak مؤكد منها.

# 20. Code Quality and Technical Debt

| العنصر | الملف | الدليل | التوصية |
|---|---|---|---|
| component ضخم | `AdminDashboard.tsx` | 1221 سطر | فصل views/hooks/repositories |
| component ضخم | `EmployeeWorkspace.tsx` | 501 سطر | فصل TaskCard/attachments/useTasks |
| أنواع ضعيفة | عدة TSX | 48 `any`; `Role=string` | Firestore models + converters + unions |
| type/data mismatch | `src/types.ts` مقابل writes | Timestamp/ISO/Date؛ `createdBy` لا يكتب | canonical schema |
| status mismatch | `types.ts`, Admin, Employee | `PendingReview` غير موجود في type ولا يُكتب؛ `Archived` لا يستخدم | state machine موحدة |
| dead code | `src/App.css` | غير مستورد، Vite template | حذف بعد موافقة |
| unused assets | `hero.png`, `logo1/2`, template SVGs، عدة ZAMAM variants | reference count صفر | تنظيم/ضغط/حذف بعد موافقة |
| unused deps | `@lordicon/react`, `clsx`, `lottie-web`, `tailwind-merge` | لا imports | إزالة مدروسة بعد tests |
| placeholder service | `googleDrive.ts:39-79` | relay placeholder وupload logs فقط | backend contract فعلي |
| duplicate branch | `AdminDashboard.tsx:220-232` | `credential-already-in-use` مرتين | توحيد handling |
| duplicated mapping | `AdminDashboard.tsx:971-1009` | نفس user mapping | helper/repository |
| weak errors | عدة ملفات | alert/console/error strings | typed error layer |
| hardcoded UI/data | `SettingsView`, analytics | version/date/status/metrics | derive from config/data |
| docs outdated | `README.md`, `project_architecture.md` | template ومعلومات غير دقيقة | توثيق setup/schema/deploy |
| CSS duplication | `tailwind.config.js`, `index.css` | نفس tokens | مصدر tokens واحد |
| undefined utility | `custom-scrollbar` usages | لا definition | تعريف أو إزالة الاسم |
| no TODO markers | كامل `src` | لا TODO/FIXME | لا يعني اكتمال الميزات؛ placeholders صريحة بالـUI |

# 21. Bugs and Incomplete Features

| Issue | النوع | Severity | الميزة | الملف | الدليل/current vs expected | الحل | التعقيد |
|---|---|---|---|---|---|---|---|
| admin route بلا role guard | Confirmed bug | High | Auth/Admin | `App.tsx`, `AdminDashboard.tsx` | أي authenticated user لا يُرفض؛ المتوقع admin roles فقط | guard + rules/claims | Medium |
| archive يعرض كل completed | Confirmed bug | High | Employee archive | `EmployeeWorkspace.tsx:60-70` | شرط archive يعود قبل assignment | filter/query authorization | Medium |
| header logout لا يسجل خروج | Confirmed bug | Medium | Session | `EmployeeWorkspace.tsx:204` | navigate فقط؛ bottom nav يستخدم `auth.signOut()` | await signOut ثم navigate | Small |
| admin approval لا يعمل | Incomplete feature | High | Pipeline | `TaskCreationModal.tsx:115`, `EmployeeWorkspace.handleMarkDone` | flag يخزن ولا يُقرأ | approval state/actor/rules/UI | Large |
| pending-review KPI دائم غالباً صفر | Confirmed bug | Medium | Dashboard | `AdminDashboard.tsx:366` | لا كود يكتب `PendingReview` | state machine موحدة | Medium |
| stage status لا يتغير | Incomplete feature | Medium | Pipeline | `handleMarkDone` | يزيد stage فقط | transaction يحدث old/new stage | Medium |
| Drive connected قد يصبح true عند failure | Confirmed bug | High | Drive | `AdminDashboard.tsx:222-232` | operation-not-allowed يسجل connected | لا تسجل نجاحاً إلا بعد تحقق | Small |
| duplicate error branch | Confirmed bug | Low | Drive | `AdminDashboard.tsx:220,229` | الفرع الثاني unreachable | دمج branches | Small |
| Drive relay placeholder | Confirmed broken config | High | Drive | `googleDrive.ts:41` | لا endpoint صالح مؤكد | backend URL عبر config + contract test | Medium |
| OAuth لا يستخدم لإنشاء folder | Incomplete architecture | High | Drive | `connectDrive`, `GoogleDriveService` | link provider منفصل عن relay | backend OAuth flow/token storage | Large |
| attachment delete لا يحذف object | Confirmed bug | High | Storage | `deleteAttachment` | metadata فقط؛ UI يقول توفير مساحة | authenticated delete API | Medium |
| temp uploads orphan | Likely bug | Medium | Storage | `TaskCreationModal.tsx:93` | يرفع قبل task/cancel | staged cleanup/finalize | Medium |
| user disable لا يعطل Auth | Confirmed incomplete | High | Team/Auth | `deleteTeamMember` | `isDeleted` فقط | Admin SDK disable/revoke | Medium |
| role deletion leaves references | Confirmed integrity bug | High | Roles | `AdminDashboard.tsx:1071-1088` | hard delete بلا checks | block/migrate refs transactionally | Medium |
| workspace deletion leaves tasks | Confirmed integrity bug | High | Workspaces | `deleteWorkspace` | hard delete فقط | block/reassign/cascade policy | Medium |
| createdBy missing from task | Confirmed bug | Medium | Auditability | `TaskCreationModal.handleSubmit` | interface requiresه لكن write لا يحتويه | server set UID | Small |
| remember me placeholder | Incomplete feature | Low | Login | `Login.tsx:168-170` | checkbox بلا state | explicit persistence أو إزالة | Small |
| forgot password placeholder | Incomplete feature | Medium | Login | `Login.tsx:167` | `href="#"` | `sendPasswordResetEmail` flow | Small |
| search/button/bell placeholders | Incomplete feature | Low | Admin | lines 413, 915-924 | لا handlers | implement/remove | Small/Medium |
| analytics inaccurate | Confirmed bug | Medium | Analytics | `AnalyticsView` | month total=all tasks؛ average ثابت؛ assignments inconsistent | canonical metrics | Medium |
| team presence fabricated | Confirmed bug | Low | Team | user mapping sets `status:'متصل'` | presence source أو neutral label | Medium |
| workspace member double count | Likely bug | Low | Workspaces | members + supervisors lengths | Set union | Small |
| role defaults incomplete | Missing requirement/Unclear | Medium | Roles | defaults لا تشمل Manager/Reviewer رغم استخدامهما | owner-defined seed | Small |
| timestamps inconsistent | Confirmed technical bug | Medium | Data | Date/Timestamp/ISO mix | serverTimestamp + converters | Medium |
| lint fails | Confirmed quality bug | Medium | Build quality | 52 errors | fix types/rules incrementally | Medium |
| no tests | Missing requirement | High | All | لا test script/files | test stack + critical flows | Large |

# 22. Dependency Audit

`package-lock.json` lockfile 3 موجود ومتوافق مع npm. كل imports الموجودة في source لها dependency معلنة؛ لم يُعثر على import مفقود.

## Security snapshot (2026-07-30)

- `npm audit`: 9 total: 1 critical، 6 high، 2 low.
- production-only: 5: 1 critical، 3 high، 1 low.
- production paths تشمل Firebase transitives (`websocket-driver`, `@grpc/grpc-js`, `protobufjs`) و`react-router`.
- development findings تشمل `vite`, `postcss`, `brace-expansion`, `@babel/core`.
- `fixAvailable=true` وفق npm لكل المجموعات، لكن لا ينبغي تطبيق auto-fix دون compatibility tests.

## Outdated snapshot

حزم لها compatible newer versions وقت الفحص تشمل Firebase, React/React DOM, React Router DOM, Vite, PostCSS, Tailwind, Framer Motion, Lucide، وأدوات lint. TypeScript latest major أعلى من spec الحالي؛ لا ترقية major تلقائية.

## Apparently unused

- `@lordicon/react`
- `clsx`
- `lottie-web`
- `tailwind-merge`

## Overlap/duplication

- `tailwind.config.js` وTailwind v4 `@theme` يكرران tokens.
- `autoprefixer` قد يكون redundant جزئياً مع Tailwind v4 toolchain، لكن يجب التحقق من browser targets قبل إزالته.
- لا duplicate runtime libraries واضحة.

## Installed-state note

`npm ls --depth=0` أظهر بعض optional/transitive packages كـextraneous في `node_modules`. هذا وصف لبيئة العمل وليس دليلاً على خطأ `package-lock`; يفضل إثبات clean CI عبر `npm ci`.

# 23. Production Readiness

| الفئة | الدرجة /10 | السبب |
|---|---:|---|
| Functionality | 5 | core prototype يعمل؛ features مهمة placeholders |
| Security | 2 | rules غير موجودة، role checks client-side، uploads غير موثقة |
| Performance | 4 | bundle وصور ضخمة وfull scans |
| Stability | 4 | لا transactions، integrations غير موثقة، lint fails |
| Testing | 0 | لا اختبارات |
| Deployment | 4 | Firebase config موجود بلا CI أو CLI/script موثق |
| Monitoring | 0 | لا monitoring/logging مركزي |
| Backups | 0 | لا policy أو scripts |
| Error handling | 3 | رسائل موجودة لكن غير موحدة ولا recovery |
| Documentation | 3 | architecture doc جزئي وREADME template |
| Scalability | 3 | full collections وclient aggregation |

**الخلاصة: Not ready for production.** بعد P0 security/data fixes يمكن اعتباره Ready only for internal testing.

# 24. Recommended Development Roadmap

## Phase 0: Immediate blockers

| الترتيب | المهمة | السبب | الملفات | dependencies | الخطر | الأولوية/التعقيد | Acceptance criteria |
|---:|---|---|---|---|---|---|---|
| 1 | تعريف Firestore/Storage rules واختبارها | لا تفويض قابل للمراجعة | ملفات rules جديدة + `firebase.json` | Firebase emulator | Critical | P0/Large | deny-by-default؛ tests لكل role/collection |
| 2 | نقل privileged user/role operations إلى backend | client role writes غير آمنة | Login/user modals/Admin | Cloud Functions/Admin SDK | Critical | P0/Large | لا client يستطيع تعيين role أو تعطيل user |
| 3 | حماية routes والعمليات | `/admin` مفتوح لكل authenticated | `App.tsx`, pages | claims/profile hook | High | P0/Medium | unauthorized redirect ولا privileged UI flash |
| 4 | تأمين/استبدال R2 Worker | upload abuse/data risk | `r2Service.ts`, Worker repo | signed URL/auth | High | P0/Large | auth، limits، allowlist، delete، tests |
| 5 | تحديث الاعتماديات الأمنية | 5 production findings | package files | regression tests | High | P0/Medium | npm audit reviewed؛ build/e2e passes |
| 6 | منع orphan/data-loss deletes | workspace/role/file integrity | Admin/Employee | transactions/backend | High | P0/Medium | block/cascade policy واختبارات |

## Phase 1: Stabilization

| الترتيب | المهمة | السبب | الملفات | الخطر | الأولوية/التعقيد | Acceptance criteria |
|---:|---|---|---|---|---|---|
| 7 | canonical Firestore schema/converters | timestamps/any/status مختلفة | `types.ts`, data layer | High | P1/Large | schema واحدة وruntime validation |
| 8 | transaction-safe pipeline state machine | races/approval missing | task/employee/backend | High | P1/Large | actor verified، stage/history atomic |
| 9 | auth lifecycle | logout/reset/disable/revoke | Login/Employee/backend | High | P1/Medium | reset يعمل؛ كل logout يقطع الجلسة |
| 10 | error layer + observability | alerts/console فقط | shared services/pages | Medium | P1/Medium | typed errors، correlation، monitoring |
| 11 | CI quality gate | lint/tests غير مفروضة | CI config/package scripts | Medium | P1/Medium | clean install, typecheck, lint, test, build |

## Phase 2: Complete Existing Features

| الترتيب | المهمة | السبب | الملفات | الأولوية/التعقيد | Acceptance criteria |
|---:|---|---|---|---|---|
| 12 | admin approval UI/workflow | flag غير مستخدم | Task modal/Admin/Employee | P1/Large | pending/reject/approve auditable |
| 13 | Drive integration حقيقي أو إزالته | placeholder وحالة مضللة | `googleDrive.ts`, settings | P1/Large | authenticated folder creation أو feature off |
| 14 | analytics الصحيحة | أرقام placeholder | Admin analytics | P2/Medium | time-bounded documented metrics |
| 15 | search/notifications/settings | controls وهمية | Admin views | P2/Medium/Large | لا control بلا وظيفة |
| 16 | role/workspace lifecycle | references | Admin/data layer | P1/Medium | safe delete/migration |

## Phase 3: Code Quality and Architecture

| الترتيب | المهمة | السبب | الملفات | الأولوية/التعقيد | Acceptance criteria |
|---:|---|---|---|---|---|
| 17 | data repositories/hooks | UI tightly coupled | pages/components/lib | P2/Large | CRUD خارج views، typed contracts |
| 18 | تفكيك الصفحات | 1221/501 lines | Admin/Employee | P2/Medium | views/cards/modals مستقلة |
| 19 | إزالة `any` وإصلاح lint | 52 errors | `src/` | P1/Medium | `npm run lint` success |
| 20 | اختبارات unit/integration/e2e | صفر coverage | test config/files | P1/Large | critical matrix covered |
| 21 | تنظيف deps/assets/docs | dead code وحجم repo | package/assets/docs | P2/Small | no unused artifacts، README فعلي |
| 22 | accessibility | لا ARIA/focus | all UI | P2/Medium | axe بلا critical violations |

## Phase 4: Performance and Scalability

| الترتيب | المهمة | السبب | الملفات | الأولوية/التعقيد | Acceptance criteria |
|---:|---|---|---|---|---|
| 23 | query design + indexes + pagination | full collections | data layer/rules/indexes | P2/Large | bounded reads per screen |
| 24 | image optimization | >15MB used images | assets/imports | P2/Small | first-load images بميزانية محددة |
| 25 | route/code splitting | 809KB JS | `App.tsx`, Vite | P2/Medium | chunks تحت budget |
| 26 | aggregation/caching | client O(n*m) | analytics/backend | P3/Large | measured latency/cost targets |
| 27 | upload concurrency/cleanup | unbounded/orphans | upload service | P2/Medium | limits، retry، cleanup job |

## Phase 5: New Features

بعد الاستقرار فقط:

- audit log غير قابل للتعديل لكل انتقال/موافقة.
- notifications حقيقية مرتبطة بالمهام.
- due dates وSLA/escalation.
- dashboard filters/report export.
- presence إذا كان business requirement مؤكداً.

# 25. Safe Development Rules for Future Work

1. لا تعدّل `src/lib/firebase.ts` أو collection names دون خطة environment/rules/migration.
2. لا تضف privileged write إلى client؛ استخدم backend/Admin SDK وcustom claims.
3. كل collection/field جديد يجب أن يملك schema، rules tests، index plan، migration/backfill.
4. استخدم `serverTimestamp()` أو timestamp policy واحدة، لا تخلط ISO/Date/Timestamp.
5. لا تحذف role/workspace/user/file قبل فحص المراجع وتطبيق policy موثقة.
6. API responses الخارجية يجب أن تكون typed وruntime-validated بصيغة موحدة `{success,data?,error?}`.
7. لا تعرض raw error أو secrets في UI/console production.
8. أسماء React components PascalCase، hooks `useX`, handlers `handleX`, collections plural ثابتة.
9. أعد استخدام TaskCard/AttachmentList/FormField/Dialog بعد استخراجها؛ لا تكرر markup.
10. كل route protected يجب أن يتحقق من session ثم role قبل render.
11. لا تعتمد على client filtering كحماية.
12. كل upload يحتاج auth، size/type/count limits، safe object key، deletion وcleanup.
13. أضف env example بأسماء فقط؛ لا commit لأي secret. تذكر أن `VITE_*` public.
14. كل PR يجب أن يمر: clean install، typecheck، lint، tests، production build، rules tests.
15. استخدم feature branch وreview وsmall commits. هذه النسخة تفتقد `.git`؛ استعد clone فعلياً قبل العمل الجماعي.
16. لا deploy من جهاز محلي مباشرة دون staging/preview وartifact traceability.
17. راجع bundle size وFirestore read count عند كل feature بيانات.

# 26. Questions Requiring Owner Confirmation

1. ما قواعد الوصول الدقيقة لكل role ولكل collection؟ هذا يحدد Firestore rules والـqueries.
2. هل `Manager` يستطيع إنشاء/حذف tasks/users أم فقط رؤية workspaces التي يشرف عليها؟
3. هل archive يجب أن يعرض مهام المستخدم فقط، workspace، أم كل المؤسسة؟
4. ما معنى `requiresAdminApproval` ومتى تدخل المهمة `PendingReview` ومن يوافق؟
5. هل الموظف غير المسند بالاسم يمكنه claim أي stage يطابق دوره؟ وكيف يُمنع شخصان من claim متزامن؟
6. ما قائمة الأدوار الأساسية الصحيحة؟ الكود وخريطة الأدوار والseed الافتراضي غير متطابقين.
7. ما سياسة حذف workspace/role/user/task والاحتفاظ بالسجلات؟
8. هل عنوان Cloudflare Worker الحالي خدمة إنتاج فعلية؟ كودها وsecrets/rules غير موجودة.
9. من يملك Google Drive folders؟ وهل المشاركة العامة مقصودة؟
10. هل ربط Google account global أم لكل مستخدم؟ الكود يخلط الاثنين.
11. أين Firebase rules/indexes وبيئات staging/production؟
12. ما backup/retention/compliance requirements للمرفقات وبيانات الموظفين؟
13. هل `.firebaserc` alias الحالي مقصود أم خطأ؟
14. هل assets غير المستخدمة لازمة لأعمال branding مستقبلية؟
15. ما المتصفحات المدعومة وميزانية الأداء/accessibility المطلوبة؟

# 27. AI Handoff Summary

## ملخص جاهز للنقل

المشروع `ZAMAM System` هو SPA عربي RTL لإدارة فريق ومهام متعددة المراحل. Stack: React 19.2.5، TypeScript 6.0.3، Vite 8.0.10، React Router 7.15.0، Tailwind 4.2.4، Firebase 12.12.1، Framer Motion وLucide. لا يوجد backend داخل repo؛ المتصفح يتصل مباشرة بـFirebase Auth/Firestore وCloudflare R2 Worker وGoogle Apps Script relay.

Entry points:

- `index.html`
- `src/main.tsx`
- `src/App.tsx`
- routes: `/`, `/admin`, `/workspace`
- Firebase bootstrap: `src/lib/firebase.ts`

أهم المجلدات:

- `src/pages`: Login/Admin/Employee.
- `src/components`: task/user modals.
- `src/lib`: Firebase/R2/Drive.
- `src/types.ts`: models جزئية وغير متزامنة تماماً مع Firestore.
- `firebase.json`: Firebase Hosting SPA rewrite.
- `.agents/`: developer-agent design tooling، ليس runtime.

Firestore collections المستنتجة:

- `users`
- `roles`
- `tasks`
- `workspaces`
- `settings/general`

Auth:

- Email/password Firebase.
- Login يقرأ/ينشئ `users/{uid}`.
- roles إدارية توجه `/admin`.
- لا protected route role guard.
- client يكتب roles/profile؛ يجب نقل privileged operations إلى backend وفرض rules/custom claims.

Core features:

- user/team CRUD جزئي.
- dynamic task pipeline.
- stage progression/completion.
- workspaces.
- R2 attachments/links.
- dashboard/analytics أولية.
- Drive feature placeholder.

أخطر المشاكل:

1. لا Firestore/Storage rules داخل repo؛ لا يمكن إثبات authorization.
2. `/admin` لا يتحقق من role.
3. Employee يحمل كل tasks؛ archive يعرض كل completed قبل assignment filter.
4. R2 upload بلا auth/limits موثقة ولا delete endpoint.
5. 5 production dependency findings، منها critical.
6. no tests؛ lint fails بـ52 errors.
7. Drive relay placeholder وOAuth flow غير متصل بالإنشاء.
8. approval flag/stage status غير منفذين.
9. حذف role/workspace/file يترك مراجع/objects.
10. bundle/images كبيرة.

أعلى الأولويات:

- rules + emulator tests.
- privileged backend/Admin SDK/custom claims.
- route guards وserver-enforced authorization.
- secure upload/delete/cleanup.
- dependency remediation واختبارات.
- canonical schema/state machine/transactions.

الأوامر:

```bash
npm ci
npm run dev
npm run lint
npm run build
npm run preview
```

لا test أو deploy script. `npm run lint` يفشل حالياً؛ build/typecheck ينجحان.

Environment:

- لا env vars مطبقة.
- قيم Firebase وR2/Drive hardcoded.
- المتغيرات المقترحة: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_R2_UPLOAD_URL`, `VITE_GOOGLE_DRIVE_RELAY_URL`.
- لا تضع secrets في `VITE_*`.

ابدأ بمراجعة:

1. `src/App.tsx`
2. `src/pages/Login.tsx`
3. `src/pages/AdminDashboard.tsx`
4. `src/pages/EmployeeWorkspace.tsx`
5. `src/components/TaskCreationModal.tsx`
6. `src/lib/firebase.ts`
7. `src/lib/r2Service.ts`
8. `src/lib/googleDrive.ts`
9. `src/types.ts`
10. `firebase.json`, `.firebaserc`, `cors.json`

قيود العمل:

- لا تثق في UI authorization.
- لا تغير data shape بلا migration/rules/tests.
- لا تعرض config values أو credentials.
- لا تستخدم hard delete دون referential policy.
- لا توسع الملفات الضخمة؛ استخرج data layer/hooks/components مع tests.
- الحالة الحالية غير جاهزة للإنتاج.

---

## Final Verification Checklist

- [x] تمت معاينة كل مجلد رئيسي والملفات التطبيقية كاملة.
- [x] تم استبعاد `node_modules`, `.npm-cache` وcache/build outputs من التحليل العميق.
- [x] وُثقت routes الثلاثة وfallback.
- [x] تم تتبع frontend وremote backend flows.
- [x] وُثقت collections والحقول والعلاقات المستنتجة.
- [x] وُثقت env names المقترحة دون أي قيمة حقيقية.
- [x] كل finding مهم مرتبط بمسار/function/section.
- [x] الافتراضات وحالات Unable to verify معلّمة.
- [x] TypeScript وVite build تم التحقق منهما دون output داخل repo.
- [x] ESLint وdependency audit وoutdated تم تشغيلها دون fix/install.
- [x] لم يُعدّل أي source/config.
- [x] الملف الوحيد المنشأ لهذه المهمة هو `PROJECT_OVERVIEW_AND_AUDIT.md`.
