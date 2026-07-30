# تنفيذ Organization وDepartments وTeams

## النطاق المنفذ

Prompt 7 ينفذ دورة حياة الهيكل التنظيمي داخل `OrganizationStructureService` في `services/functions/src/organization/service.ts`. كل write:

1. يتحقق من input ويطبّع الاسم والرمز.
2. يستدعي backend `authorization.require` بصلاحية ثابتة يحددها الأمر.
3. ينفذ business write وreference counters وunique reservation داخل transaction.
4. يضيف audit وoutbox وidempotency record ذريًا.

لا توجد كتابة إدارية مباشرة من React أو Firestore client.

## الأوامر

| العملية | Permission | أهم القيود | Event |
|---|---|---|---|
| تحديث اسم المؤسسة | `organization.manage` | active + optimistic version | `organization.updated` |
| تحديث الإعدادات | `settings.manage` | IANA timezone، locale، week start، version | `organization.settings_updated` |
| تعليق المؤسسة | `organization.suspend` | سبب 10-500 حرف، step-up/MFA من engine | `organization.suspended` |
| إنشاء قسم | `department.create` | code فريد داخل tenant | `department.created` |
| أرشفة قسم | `department.archive` | لا Teams نشطة | `department.archived` |
| إنشاء فريق | `team.create` | Department نشط وcode فريد | `team.created` |
| أرشفة فريق | `team.archive` | لا Memberships نشطة | `team.archived` |
| إضافة عضو | `team.manage` | عدة Teams، primary واحد، allocation إجمالي ≤100 | `team.member_added` |
| إنهاء عضوية | `team.manage` | active + version؛ تحديث counters | `team.member_ended` |

إنشاء tenant جديد ليس أمر Organization عاديًا؛ يبقى provisioning داخليًا بصلاحية `platform.tenant.provision` ولا يُمنح من داخل tenant.

## Atomic indexes and counters

```text
v2Organizations/{organizationId}/_uniqueDepartmentCodes/{hash}
v2Organizations/{organizationId}/_uniqueTeamCodes/{hash}
v2Organizations/{organizationId}/_departmentActiveTeamCounts/{departmentId}
v2Organizations/{organizationId}/_teamActiveMemberCounts/{teamId}
v2Organizations/{organizationId}/_teamAllocationByUser/{userId}
v2Organizations/{organizationId}/_primaryTeamByUser/{userId}
```

هذه المستندات ليست مصدر صلاحية للعميل. تُحدّث داخل نفس transaction وتمنع TOCTOU في uniqueness والأرشفة.

## UI

`OrganizationAdminPage` في `apps/web/src/features/organization/OrganizationAdminPage.tsx` يوفر:

- RTL hierarchy view للأقسام والفرق.
- loading، error/unavailable، empty states.
- responsive rows وإحصاءات حقيقية من server projection.
- create dialogs مع labels وfocus أولي وvalidation.
- إخفاء commands بناءً على server-projected capabilities كتغذية راجعة فقط؛ backend يعيد التحقق دائمًا.

`apps/web/src/features/organization/client.ts` يعرّف transport contract. عند غياب backend URL أو session تظهر حالة unavailable ولا تُعرض بيانات مختلقة. تسجيل HTTP handlers الفعلية ينتظر composition root الذي سيجمع Membership/Employment من Prompt 8 وWorkspace scopes قبل Gate P11؛ لا يوجد fallback client write.

## Owner defaults applied

- `OD-ORG-01/02`: Organization هي tenant boundary؛ identity قابلة لعدة memberships مستقبلًا.
- `OD-DEP-01`: primary Department واحد يُنفذ مع Employment في Prompt 8؛ هذه المرحلة لا تمنح صلاحية من department text.
- `OD-DEP-02`: لا حقول أداء أو حضور في directory projection.
- `OD-TEAM-01`: عدة Teams مع primary واحد وallocation اختياري مجموعُه ≤100.
- `OD-TEAM-02`: Team scope لا يسمح بإدارة خارج الفريق؛ لا task reassignment في هذه المرحلة.

## الاختبارات

- `tests/organization-structure.test.ts`: invariants، settings، suspend، uniqueness، hierarchy، memberships، archival guards، deny-before-write، idempotency.
- `tests/organization-ui.test.tsx`: RTL rendering، axe، empty/capability states، create command flow.
- Firestore client writes تظل denied وفق Gate P6.

## Deferred production configuration

- لا tenant production provisioning.
- لا production migration أو index creation.
- لا Firebase HTTP binding قبل اكتمال trusted membership projection.
- لا بيانات HR أو attendance في هذا Prompt.
