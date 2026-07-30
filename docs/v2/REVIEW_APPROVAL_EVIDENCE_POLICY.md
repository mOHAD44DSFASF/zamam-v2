# Review and Approval Evidence Policy

الحالة: **منفذ في Prompt 16**.

## Evidence

كل `ReviewRequest` يثبت `taskId`, `reviewedVersion`, `round`, policy, visibility, reviewers وapproval IDs. كل reviewer يملك `Approval` مستقلًا. القرار الأول فقط نهائي ويحفظ reviewer، الوقت، النتيجة، السبب عند الرفض/التعديل، ونسخة العمل المراجعة.

إذا تغير `task.version` بعد الطلب، يفشل القرار `REVIEWED_VERSION_STALE`. لا يعتمد النظام على عنوان أو محتوى mutable لإثبات ما تمت مراجعته.

## Policies

- `single`: reviewer واحد فقط.
- `any`: أول موافقة تكمل الطلب وتلغي pending approvals دون حذفها.
- `all`: لا تكتمل الموافقة حتى موافقة الجميع.
- `ordered`: مثل all مع منع reviewer اللاحق قبل السابق.

`rejected` و`changes_requested` ينهيان الدورة الحالية. القرار غير approved يتطلب سببًا.

## Segregation and visibility

- task creator لا يكون reviewer لنفس المهمة افتراضيًا.
- internal decision يتطلب `review.perform`.
- client-visible decision يتطلب `task.approve` ويخضع client boundary.
- `ReviewEligibilityPort` يثبت نشاط reviewer ونطاق العميل/المشروع قبل الإنشاء أو delegation.
- UI hiding ليست authorization.

## Changes and resubmission

`changes_requested` ينشئ `ChangeRequest` open مرتبطًا بالدورة. بعد تعديل المهمة:

- resubmit يتطلب version أحدث ومطابقًا للسجل.
- يغلق change request السابق.
- يزيد `round`.
- ينشئ Approval records جديدة.
- يحتفظ بكل قرارات الدورات السابقة.

## Delegation and expiration

delegation تتطلب `approval.delegate`, reviewer identity، سببًا، وdelegate eligible. الأصل يصبح `delegated` immutable، وينشأ approval جديد يشير إلى الأصل.

job expiration يستخدم `task.override_transition`; لا ينتهي طلب قبل `dueAt`. pending approvals تصبح `expired` وتبقى evidence.

## Conflicts

- duplicate decision: `APPROVAL_DECISION_IMMUTABLE`.
- stale task: `REVIEWED_VERSION_STALE`.
- wrong reviewer: `REVIEWER_IDENTITY_MISMATCH`.
- ordered conflict: `ORDERED_APPROVAL_NOT_READY`.
- concurrent request/approval version: version/state rejection داخل transaction.

## Query and UI

Inbox يبدأ من `approval(reviewerUserId, status=pending, createdAt ASC)` بحد 50 وcursor. `/approvals` يعرض task version, round, policy, visibility، والسبب المطلوب قبل reject/change.

## الاختبارات

- `tests/review-approval.test.ts`: 9 اختبارات any/all/ordered/stale/change/resubmit/delegate/expire/client.
- `tests/review-inbox-ui.test.tsx`: 2 اختبار accessibility/evidence/change reason.

