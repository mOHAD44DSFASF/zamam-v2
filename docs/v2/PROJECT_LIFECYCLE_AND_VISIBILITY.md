# دورة حياة المشروع وحدود الرؤية

الحالة: **منفذ في Prompt 10**. هذا المستند يصف السلوك الفعلي في V2 ولا يغيّر بيانات V1.

## دورة الحياة

يطبق `packages/domain/src/project.ts` الانتقالات التالية فقط:

| الحالة الحالية | الانتقالات المسموحة |
|---|---|
| `draft` | `planned`, `cancelled` |
| `planned` | `active`, `on_hold`, `cancelled` |
| `active` | `on_hold`, `completed`, `cancelled` |
| `on_hold` | `active`, `cancelled` |
| `completed` | `archived` |
| `cancelled` | `archived` |
| `archived` | لا يوجد |

إعادة فتح مشروع `completed` عملية مستقلة تتطلب `project.reopen` وسببًا من 10 إلى 500 حرف، وتسجل `reopenedAt` و`reopenedBy` وحدث audit/outbox. كل كتابة تستخدم `expectedVersion` لمنع الكتابة المتزامنة الصامتة.

## الإنشاء والمراجع

ينفذ `ProjectService.create` في `services/functions/src/project/service.ts` عملية ذرية تتحقق من:

- وجود عميل `active` داخل نفس `organizationId`.
- وجود القسم النشط عند تحديده.
- وجود `EmploymentProfile` نشط لمدير المشروع.
- فرادة `code` بعد التطبيع داخل المؤسسة.
- صحة نطاق التاريخ.

يبدأ المشروع بالحالة `draft` و`clientVisible: false`. لا تنشئ العملية Workspace أو Task أو عضوية تلقائية.

## العضوية

تتطلب إدارة الأعضاء `project.member.manage`.

- العضو الداخلي يجب أن يملك `EmploymentProfile.status = active`.
- جهة اتصال العميل يجب أن تتبع عميل المشروع نفسه، وأن تملك `portalStatus = active` و`userId`.
- وصول العميل يثبت دائمًا على `viewer`; لا يقبل `contributor` أو `manager`.
- العضوية تحفظ `userId` الحقيقي، ومع العميل تحفظ أيضًا `contactId` للتتبع.

## حدود الرؤية

`projectProjectFields` في `packages/domain/src/project.ts` يقدم ثلاث إسقاطات:

- `client`: الحقول المشتركة فقط، ويرفض المشروع ما لم يكن `clientVisible = true`.
- `internal`: الحقول المشتركة مع `managerUserId` و`departmentId`.
- `financial`: الإسقاط الداخلي مع البيانات المالية المصرح بها.

قائمة العميل في `buildProjectListQuery` تتطلب `clientId` وتضيف مرشح `clientVisible == true`. الاستعلامات محدودة إلى 50 عنصرًا وتدعم cursor.

تغيير الرؤية عملية backend مدققة عبر `setClientVisibility`; إخفاء زر الواجهة ليس تحكمًا أمنيًا.

## البيانات المالية

الميزانية ونموذج الفوترة لا يوجدان في وثيقة `project`. تحفظ في كيان مستقل `project_financials` وتتطلب:

- القراءة: `project.financial.view`.
- التعديل: `project.financial.manage`.
- optimistic concurrency.
- منع التعديل بعد `status = locked`.

واجهة `apps/web/src/features/projects/ProjectManagementPage.tsx` تعرض حالة صريحة عند غياب صلاحية القراءة ولا ترسل حقولًا مالية أثناء إنشاء المشروع.

## الأرشفة

تتطلب `project.archive` وحالة طرفية (`completed` أو `cancelled`). يمنع `ProjectLifecyclePort` الأرشفة إذا وجد Workspace نشط أو Task مفتوح. الأرشفة لا تحذف السجل، وتحرر فهرس الرمز، وتخفض عداد مشاريع العميل، وتسجل audit/outbox.

## أدلة الاختبار

- `tests/project-management.test.ts`: 7 اختبارات للخدمة والمجال.
- `tests/project-ui.test.tsx`: 3 اختبارات RTL وaccessibility وتكامل الأوامر.

