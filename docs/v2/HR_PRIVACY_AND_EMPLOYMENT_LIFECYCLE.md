# HR Privacy and Employment Lifecycle

## دورة الحياة

| الحالة | Membership | Employment | Identity |
|---|---|---|---|
| دعوة | `invited` | `planned` | موجودة؛ لا تمنح وصولًا دون Session Membership فعالة |
| قبول | `active` | `active` | session يعاد تقييمها |
| تعليق | `suspended` | `suspended` | refresh tokens تُبطل؛ global identity تُعطل فقط إن لم توجد عضوية tenant أخرى |
| مغادرة | `left` | `ended` | كل access refs تُلغى؛ identity policy مثل التعليق |

لا تستخدم الدعوة كلمة مرور مؤقتة، ولا تقبل `roleId` أو role name. منح الأدوار عملية منفصلة عبر `RoleAssignmentService`.

## Invitation saga

`EmployeeService.invite`:

1. يتحقق من `user.invite` في backend.
2. يستدعي `EmployeeIdentityPort.provisionInvitation` idempotently.
3. ينشئ atomically: `organization_membership` و`user_profile` و`employment_profile` و`invitation` وunique indexes وaccess state وaudit/outbox.
4. عند فشل transaction، يحذف فقط Identity التي أنشأتها المحاولة نفسها. لا يحذف Identity مشتركة موجودة سابقًا.
5. worker يستهلك `user.invited` لإرسال رابط القبول؛ لا توجد رسالة حقيقية أو provider credential في هذه المرحلة.

`FirebaseEmployeeIdentityAdapter` يستخدم Firebase Admin SDK فقط. لا ينشئ React مستخدمًا ولا يكتب client role.

## Disable and departure safety

- self-disable مرفوض.
- آخر Owner محمي قبل أي mutation.
- Membership/access state تُقفل أولًا؛ لذلك تعطل مزود الهوية لا يعيد الوصول.
- refresh tokens تُبطل دائمًا.
- Firebase global identity تُعطل فقط عندما يؤكد `hasOtherActiveMemberships=false`.
- المغادرة تلغي `role_assignment` و`team_membership` و`project_member` داخل audit transaction.
- Team counters وallocation وprimary-team index تُصحح مع الإلغاء.
- أكثر من 400 reference يتحول إلى bounded batch workflow بدل transaction غير محدودة.
- لا hard delete؛ سبب وتاريخ النهاية محفوظان.

## PII projections

`projectEmployeeFields` في `packages/domain/src/employee.ts` يفصل:

| Projection | الحقول |
|---|---|
| `directory` | user id، display name، job title، department، employment type/status |
| `hr` | directory + manager/start/end/contact fields |
| `compensation` | HR + compensation |

الواجهة `EmployeeDirectoryPage` لا تستقبل email أو phone أو compensation. `employment.compensation.view` مطلوب لخدمة projection المستقبلية ولا يُستنتج من دور مدير القسم.

Tenant invitation records تخزن `emailHash` فقط. البريد الخام يبقى لدى identity provider ولا يدخل broad tenant queries أو outbox payload.

## Work schedules

- `work_schedule.manage` فقط.
- IANA timezone صالح.
- `weeklyMinutes` بين 0 و10,080.
- `effectiveFrom/effectiveTo` بصيغة date-only صحيحة وترتيب زمني صالح.
- optimistic version؛ schedule مرتبط بEmployment atomically.
- Attendance/time/payroll خارج Prompt 8.

## UI

`apps/web/src/features/employees/EmployeeDirectoryPage.tsx` يوفر directory/search/empty/error/loading، invite dialog بلا role، وتعطيلًا بتأكيد وسبب. Server capabilities للتغذية الراجعة فقط؛ backend يعيد authorization.

## Verification

- `tests/employee-management.test.ts`: invitation success/compensation، no role/raw email، last Owner، session deny، identity failure، multi-tenant identity، departure cleanup، schedules، projections.
- `tests/employee-ui.test.tsx`: RTL/axe، invite without role، disable confirmation.
- Firebase Admin adapter لا يُستدعى في الاختبارات المحلية؛ لا production contact.

## Deferred

- رابط invitation provider الفعلي وemail delivery إلى Prompt 20.
- HTTP composition root بعد اكتمال membership/workspace scopes قبل Gate P11.
- compensation/payroll وattendance/time خارج هذا Prompt.
