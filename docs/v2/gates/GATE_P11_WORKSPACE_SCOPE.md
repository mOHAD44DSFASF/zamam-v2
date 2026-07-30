# Gate P11: Workspace Scope and Migration

النتيجة: **PASS** في 2026-07-30. البيئة local/emulator فقط.

| البوابة | الدليل | النتيجة |
|---|---|---|
| Security | `authorization-engine.test.ts` يغطي organization/department/team/project/workspace؛ `workspace-redesign.test.ts` يفرض المراجع والعضوية؛ Firestore emulator يرفض forged workspace claims | PASS |
| Data | inventory يحاسب users/roles/workspaces؛ Admin لا يصبح Owner؛ orphan يصبح quarantine؛ rerun حتمي؛ staging rollback موجود | PASS |
| Tests | 13 اختبار Prompt 11 مركزًا، typed API route integration، و5/5 rules emulator | PASS |
| Performance | membership query cursor-based وحده 50؛ composite index موثق | PASS |
| Documentation | `WORKSPACE_MEMBERSHIP_AND_V1_MAPPING.md` وقرارات owner المعتمدة | PASS |

## Stop conditions

- unknown privileged legacy mapping: غير موجود في rehearsal المقبول.
- unclassified orphan: غير موجود في rehearsal المقبول.
- cross-organization reference: مرفوض.
- array-based client authorization: غير مستخدم.
- direct client write: مرفوض بواسطة `firestore.rules`.

عند ظهور أي شرط في بيانات staging فعلية تكون النتيجة **STOP** حتى التصنيف اليدوي. لم تُفحص بيانات production ولم يجر cutover.

## قرار المتابعة

يجوز بدء Prompt 12. يبقى تركيب adapters الفعلية لكل feature route جزءًا إلزاميًا عند تنفيذ الخدمة؛ route registry يرفض أي route غير مسجل.

