# تنفيذ Authorization في ZAMAM V2

## الحالة

Prompt 5 مكتمل على مستوى المحرك والخدمة الموثوقة. يظل تخزين roles/assignments الفعلي وconverters ضمن P6، وشاشات الإدارة ضمن الوحدات اللاحقة.

## مصادر الحقيقة

- catalog: `packages/authorization/src/catalog.ts` ويحتوي identifiers صريحة؛ أي identifier غير معروفة = deny.
- engine: `packages/authorization/src/engine.ts`، pure function بلا Firebase أو React.
- defaults: `packages/authorization/src/default-roles.ts`؛ المؤسسات تستطيع إنشاء custom roles.
- backend facade: `services/functions/src/authorization/service.ts`.
- defense-in-depth rules: `firestore.rules`؛ self `sessionViews` get فقط، وكل client write مرفوض.

## ترتيب القرار المنفذ

1. authenticated identity.
2. token freshness.
3. account/employment active.
4. known permission.
5. selected organization + active membership + resource tenant match.
6. client visibility hard boundary.
7. trusted active role assignments/time windows.
8. matching explicit deny قبل grants.
9. resource scope.
10. step-up/MFA.
11. business-state callback.
12. sensitive audit.

الناتج الآمن: `allowed`, `reason`, `policyVersion`, `effectiveScope`, `auditRequired`. لا يعرض backend تفاصيل role assignment للعميل.

## Scope semantics

- `organization`: كل children داخل tenant، مع بقاء deny وvisibility.
- `department`: resource department أو department نفسه.
- `team`: team-owned resources، لا كل موارد الأعضاء.
- `project`, `workspace`, `client_account`: تطابق المرجع المحدد.
- `self`: owner/assignee/user-self فقط، ولا يمنح permission بذاته.
- `resource`: تطابق `resourceType + id`.
- `platform`: بلا tenant resource؛ SystemAdministrator لا يقرأ tenant content تلقائياً.

## Anti-escalation

`RoleAssignmentService` يتطلب `role.assign` مع step-up، policy version متوقع، role نشط داخل نفس organization، وكل target permission ضمن صلاحيات actor، وtarget scope داخل actor scope. persistence backend port فقط ويسجل القرار الحساس.

## اختبارات الأمن

- unknown permission، stale token، disabled/archived، inactive membership.
- cross-organization لكل الأدوار الافتراضية العشرة.
- explicit deny precedence.
- scope matrix organization/department/team/project/workspace/self/resource.
- client internal visibility hard deny.
- SystemAdministrator tenant isolation.
- step-up/MFA وanti-escalation وpolicy-version conflict.
- Firestore recursive default deny static check.

Firestore emulator execution مؤجل إلى Gate P6 بسبب غياب Java في البيئة، ولا يوجد fallback إلى production.
