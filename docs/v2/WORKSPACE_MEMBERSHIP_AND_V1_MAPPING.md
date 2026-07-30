# Workspace Membership وإعادة تصميم V1

الحالة: **منفذ في Prompt 11**. لم تُقرأ أو تُكتب بيانات production.

## نموذج V2

وثيقة `workspace` لا تحتوي مصفوفات صلاحيات. الحقول المنفذة هي:

- `organizationId`, `schemaVersion`, `version`.
- `name`, `status`, `visibility`.
- `projectId?`, `departmentId?`, `ownerTeamId?`.
- `createdBy`, timestamps، وحقول الأرشفة.

كل وصول صريح يمثله كيان `workspace_member` مستقل: `workspaceId`, `userId`, `membershipRole`, `source`, `status`, `joinedAt`, `endedAt?`. إنشاء Workspace يضيف المنشئ كـ `manager` في نفس المعاملة.

## قواعد النطاق

ينفذ `packages/domain/src/workspace.ts` القواعد التالية:

- `visibility=project` يتطلب `projectId`.
- `visibility=team` يتطلب `ownerTeamId`.
- `ownerTeamId` يتطلب `departmentId`.
- مشروع Workspace وقسمه وفريقه يجب أن تكون مراجع نشطة ومتوافقة داخل المؤسسة نفسها.
- عضوية `source=project` تتطلب عضوية مشروع داخلية نشطة؛ عضوية العميل لا تتحول ضمنيًا إلى وصول داخلي.
- الأرشفة ممنوعة مع مهام مفتوحة، ولا يوجد hard delete.

تتطلب العمليات `workspace.create`, `workspace.member.manage`, أو `workspace.archive`. خدمة `services/functions/src/workspace/service.ts` تفوض قبل الكتابة وتسجل audit وoutbox وتدعم idempotency.

## Tenant Context

`apps/web/src/tenant/TenantProvider.tsx` يختار فقط `organizationId` موجودًا ضمن العضويات النشطة في `sessionViews`. الاختيار يحفظ في `sessionStorage` للتبويب الحالي فقط ويعاد التحقق منه عند تغير session. إدخال معرف مؤسسة غير موجود يفشل بـ `CROSS_ORGANIZATION_DENIED`.

هذا السياق لتحسين UX وتثبيت نطاق الطلب فقط؛ backend يعيد التحقق ولا يثق في القيمة القادمة من المتصفح.

## API composition

يدعم `createApi` في `services/functions/src/api/api.ts` الآن `TrustedApiRoute` registry. جميع feature routes تمر بالترتيب نفسه:

1. CORS allowlist.
2. request-size وschema validation.
3. App Check.
4. Firebase ID token verification مع revocation check.
5. per-operation rate limit.
6. idempotency key وbody fingerprint.
7. feature handler.
8. response envelope وcorrelation logging.

الخدمات لا تعتمد على HTTP، ويجب أن يسجل composition root adapters التخزين والسياسة قبل تمكين route. المسارات غير المسجلة ترجع `NOT_FOUND`; لا يوجد fallback إلى كتابة Firestore من React.

## V1 mapping

المصدر المؤكد من `apps/web/src/pages/AdminDashboard.tsx`:

- `workspaces/{id}.members[]`.
- `workspaces/{id}.supervisors[]`.
- `createdBy`.
- `tasks.workspaceId`.

ينفذ `mapLegacyWorkspaces` تحويلًا حتميًا:

| V1 | V2 |
|---|---|
| document | `workspace` مع `visibility=private` حتى قرار نشر صريح |
| `createdBy` | `workspace_member.membershipRole=manager` |
| `supervisors[]` | `workspace_member.membershipRole=supervisor` |
| `members[]` | `workspace_member.membershipRole=member` |
| عضو مكرر | سجل واحد، والأعلى `supervisor` |
| user reference غير موجود | quarantine، بلا grant |
| creator غير موجود | issue `MISSING_CREATOR`؛ لا يُخترع Owner |

`buildLegacyFoundationInventory` يحاسب `users`, `roles`, `workspaces`. `Admin` يقترح `GeneralManager` مع `grantsApplied=false`; لا يستنتج `Owner`. `Manager` والأدوار الديناميكية تبقى quarantine حتى scope resolution.

## rehearsal المحلي

نفذت الاختبارات inventory اصطناعيًا وآمنًا:

- source: user=1, role=1, workspace=1.
- accounted: user=1, role=1, workspace=1.
- mapped Admin: `GeneralManager`, no grants applied.
- orphan/unclassified: 0 في سيناريو المرور.
- rerun: نفس records والissues حتميًا.
- rollback: آلية staging المقيدة والمختبرة في `packages/firestore/src/migration.ts`; V1 لم يتغير.

سيناريو منفصل أثبت quarantine لعضو يتيم ومنشئ يتيم. أي orphan غير مصنف أو legacy privileged mapping غير محسوم يوقف Gate P11.

## الاستعلام والفهرسة

`buildWorkspaceMembershipQuery` يقرأ `workspace_member` بمرشحي `userId` و`status=active`، يرتب بـ `workspaceId`، ويفرض حدًا أقصى 50 مع cursor. الفهرس المركب المتوقع:

`workspace_member(userId ASC, status ASC, workspaceId ASC)`.

لا يستخدم client-side filtering أو `array-contains` كمصدر تفويض.

