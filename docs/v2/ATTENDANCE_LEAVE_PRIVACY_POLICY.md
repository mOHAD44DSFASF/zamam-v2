# سياسة الحضور والإجازات والخصوصية

## التنفيذ

- Attendance يدوي فقط في Prompt 23؛ لا GPS ولا biometrics ولا device integration.
- holiday له أولوية على leave، وleave له أولوية على check-in مشتق.
- التأخير بعد سماح خمس دقائق من scheduled start؛ القاعدة قابلة للتهيئة قبل launch.
- كل تصحيح ينشئ `attendance_correction` قبل تحديث العرض الحالي؛ لا silent correction.
- leave days شاملة تاريخي البداية والنهاية، والتداخل في اليوم الحدّي مرفوض.
- المدد حتى 3 أيام تعتمد بواسطة TeamLeader؛ الأطول تمر TeamLeader ثم
  DepartmentManager وفق default المعتمد وقابلية resolver للتهيئة.
- self approval وترتيب مخالف لسلسلة الاعتماد مرفوضان.

## Balance and Capacity

عند الطلب ينشأ ledger `reserve` ويزيد `pendingDays`. الرفض ينشئ `release`.
الموافقة النهائية فقط تنشئ `consume` وتنقل الأيام من pending إلى used وتصدر
`leave.approved`. لذلك يستهلك workload الحدث مرة واحدة ولا يخصم leave في كل خطوة
اعتماد.

إذا كان `source=external_hr` فالميزان read-only ويفشل command مغلقًا حتى يتوفر
adapter موثوق. لا يصبح ZAMAM مصدر حقيقة ثانٍ.

## Privacy

الأسباب والسجلات اليومية HR-sensitive. `attendance.view_team` و`leave.view_team`
لا يمنحان compensation أو performance access. واجهة self لا تعرض فريقًا. كل
manager operation يحتاج resource scope وaudit. تحديد دول التشغيل والاستشارة
القانونية في `OD-PRV-01` شرط launch لإصدار Management.

## Rollback

يعطل ingestion والاعتمادات مع الحفاظ على attendance/correction/leave/ledger.
تسوّى reservations المفتوحة عبر job مدقق؛ لا تحذف السجلات ولا تغير production
بـclient script.
