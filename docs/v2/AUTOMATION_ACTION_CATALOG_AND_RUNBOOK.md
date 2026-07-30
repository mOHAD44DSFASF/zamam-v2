# Automation Action Catalog and Runbook

P25 يستخدم قواعد declarative فقط. actions المسموحة: `notification.create`
(`notification.deliver`)، `task.add_watcher` (`task.watcher.manage`) و
`task.add_tag` (`task.update`). الحذف والصلاحيات والموافقات والمال وarbitrary code
مرفوضة. التشغيل بهوية Service Principal محدودة وscope ثابت.

الحدود: 10 conditions، 5 actions، depth أقل من 3، 100 run/ساعة لكل automation،
5 attempts ثم DLQ. run ID حتمي من automation/version/event، ولكل action
idempotency key مستقل. pause automation يوقف runs جديدة؛ drain الجاري ثم retry
إداري بعد إصلاح السبب. كل نتيجة action قابلة للتتبع ولا تخزن event payload كاملًا.
