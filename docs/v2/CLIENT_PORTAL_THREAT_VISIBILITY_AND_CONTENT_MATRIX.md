# بوابة العميل: التهديدات والرؤية والمحتوى

## حد الثقة

بوابة العميل تستخدم Firebase identity عادية، لكن كل طلب يعيد تحميل حالة الحساب والعضوية من مصدر موثوق. وجود `ClientContact` أو بريد مطابق لا يمنح وصولاً. يلزم `portalStatus=active`، و`clientAccountIds` موثوقة، و`ProjectMember(principalType=client, access=viewer, status=active)` صريحة لكل مشروع.

## مصفوفة المحتوى

| المورد | ما يصل إلى Portal | ما يحظر دائماً |
|---|---|---|
| Project | id، name، code، status، dates | financials، departmentId، managerUserId |
| Task | id، title، status، dueAt إذا `clientVisible=true` | assignees، workload، internal fields |
| Comment | body ووقت الإنشاء إذا `visibility=client` | internal comments، edit/audit metadata |
| File | displayName وversion؛ download grant قصير بعد تحقق مستقل | `objectKey`، provider credentials، permanent URL |
| Approval | exact reviewer، reviewedVersion، dueAt، evidence reference | internal approvals والمراجعين الآخرين |
| Delivery | title ووقت التسليم للمشروع المسموح | internal file lifecycle وscan details |
| Notification | client-visible minimized payload | internal event payload |

## التهديدات والضوابط

| التهديد | الضابط | اختبار |
|---|---|---|
| Cross-organization/client IDOR | organization من session + client account + project membership | `client-portal.test.ts` |
| Internal field leakage | DTO allowlist مستقل، لا إعادة استخدام internal payload | projection serialization test |
| Stale/forged approval | reviewer identity + exact reviewed version + immutable ReviewService evidence | reviews + portal integration |
| File disclosure | client visibility + clean/active state + signed short download | file-management tests |
| Disabled contact session | token freshness + status reload + refresh-token revoke | auth/client tests |
| Enumeration | generic `PORTAL_PROJECT_DENIED` قبل كشف المورد | unauthorized project test |
| XSS/content | React escaping، backend validation، no raw HTML | UI/accessibility tests |

## التشغيل والخصوصية

Feature flag `CLIENT_PORTAL_ENABLED` يعطل endpoints والواجهة دون تعطيل العمليات الداخلية. حادث تسريب يوقف العلم، يبطل جلسات جهات الاتصال المتأثرة، ويلغي download grants، ثم يحدد الأثر عبر correlation/audit events. المراجعة القانونية وسياسة الخصوصية واتفاقيات معالجة البيانات متطلبات إطلاق خارج الكود.

## الدعم

لا يعرض الدعم بيانات العميل إلا بتفويض مؤقت ومدقق. التنزيلات لا تعاد بالبريد. تغيير جهة اتصال أو مشروع يتطلب إعادة تقييم العضويات. لا يوجد billing أو white-label كامل في الإصدار الأول.
