# سياسة التعليقات والتعاون

## القرار المعتمد

تطبق هذه السياسة القرارين `OD-COM-01` و`OD-COM-02`:

- التعليق المرتبط بمراجعة أو موافقة يقفل فورًا، ولا يتغير نصه أو يحذف. التصحيح تعليق جديد يحفظ تسلسل الأدلة.
- Client principal لا يستطيع إنشاء أو قراءة `internal` comments. قناة العميل هي `visibility=client` فقط وعلى مورد مثبت backend أنه ظاهر لحساب العميل.
- التعليق العادي قابل للتعديل أو tombstone من مؤلفه خلال 15 دقيقة. لا يوجد hard delete.

## حدود الثقة

الـfrontend لا يرسل claims موثوقة عن العميل أو المشروع أو المؤلف. `CollaborationResourcePort` يحل `organizationId` وscope و`clientAccountId` وvisibility من persistent trusted projection قبل authorization. يعاد فحص المورد والتعليق داخل transaction. أي اختلاف tenant أو resource أو parent أو review يؤدي إلى deny.

القنوات منفصلة في:

1. permission: `comment.internal.*` مقابل `comment.client.*`.
2. command input: visibility صريحة وغير قابلة للتعديل.
3. query: client query يفرض `visibility == client`؛ member query يطلب القناتين صراحة.
4. DTO: portal لا يحصل على raw internal activity أو audit events.

`buildResourceActivityQuery` يرفض Client principal ويطلب `CLIENT_ACTIVITY_PROJECTION_REQUIRED`. يبنى client activity في Prompt 27 من allowlist events وحقول مخفضة، وليس من raw audit log.

## المحتوى والحدود

- body plain text فقط، Unicode NFC، وطوله 1–4000.
- React escaping هو طبقة العرض؛ يمنع إدخال control characters ولا يحقن HTML.
- replies يجب أن تطابق resource وvisibility للأصل، ولا يمكن الرد من قناة العميل على تعليق داخلي.
- pagination إلزامية بحد أقصى 50، مع cursor وترتيب canonical.
- real-time chat، rich HTML، ورفع الملفات داخل النص خارج Prompt 18.

## Mentions

الإشارة قائمة IDs صريحة بحد أقصى 20، وليست parser لأسماء العرض. يتحقق backend من:

- عضوية target نشطة.
- وصول target إلى المورد.
- وصول target إلى visibility نفسها.
- Client mention لا يشير إلى موظف داخلي غير مكشوف في portal.

يولد `mention` مستقل وevent `comment.created` واحد يحوي IDs، وتنفذ notification fan-out في Prompt 20. التكرار مرفوض، ولا يخزن البريد أو بيانات حساسة في event.

## Reactions وWatchers

- أنواع reactions محدودة: `like`, `celebrate`, `support`, `insightful`.
- الهوية حتمية من `commentId:userId:type`، فتمنع duplicate وتدعم add/remove idempotent.
- comment author يصبح watcher للمهمة تلقائيًا. `task.watch` يتيح self follow/unfollow، و`task.watcher.manage` للإدارة المقيدة.
- watcher لا يمنح أي حق قراءة؛ notification worker يعيد authorization قبل التسليم.

## Audit والتراجع

كل create/update/tombstone/reaction/watch command يمر عبر `AuditCommandService` وينتج audit وoutbox وidempotency record ذريًا. tombstone يستبدل body بقيمة ثابتة ويحتفظ metadata والتاريخ. rollback هو تعطيل create commands مع إبقاء التعليقات وسجلات التعاون؛ لا تحذف history.

## التهديدات والضوابط

| التهديد | الضابط |
|---|---|
| تسرب تعليق داخلي للعميل | permission + trusted resource + query projection منفصلة |
| تعديل دليل موافقة | `lockedAt` وbusiness-state guard |
| XSS/control payload | plain text، normalize، React escaping، limits |
| mention spam | 20 target limit؛ rate limiting عند API؛ recipient authorization |
| duplicate reaction/watcher | deterministic identity + transaction + idempotency |
| حذف التاريخ | tombstone فقط؛ audit append-only |
| unbounded feed | cursor وlimit <= 50 |

## متطلبات التشغيل

تراقب معدلات create/mention/reaction، command denial، payload rejection، queue lag، وclient projection mismatch. لا يرسل Prompt 18 رسائل حقيقية؛ outbox يبقى محليًا حتى Notification Center في Prompt 20.
