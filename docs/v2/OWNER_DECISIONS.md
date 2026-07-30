# قرارات المالك المطلوبة لـ ZAMAM V2

## 1. الغرض وطريقة الاستخدام

هذا السجل يحصر القرارات التشغيلية والتجارية التي لا يمكن تأكيدها من المستودع الحالي. لا تُعد القيم المقترحة قواعد نهائية؛ بل هي **Recommended defaults** قابلة للاعتماد أو التعديل من المالك. يجب تسجيل القرار النهائي، وصاحبه، وتاريخه، وأسبابه قبل الموعد المحدد.

ترميز المواعيد مثل `قبل P5` يعني قبل بدء Prompt 5 في [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md). أي قرار غير محسوم عند موعده يمنع تنفيذ الجزء المعتمد عليه، ولا يسمح بتحويل الافتراض إلى قاعدة صامتة.

## 2. Organization model

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-ORG-01` | هل يمثل كل حساب مؤسسة قانونية واحدة، أم يمكن للمؤسسة إدارة علامات أو فروع مستقلة داخله؟ | يحدد حدود العزل والتقارير والإعدادات | Organization واحدة مع Branches تنظيمية غير مستقلة | Tenant لكل فرع؛ أو Organizations مترابطة | تصميم السياق والتنقل | `organizationId` واحد مع `branchId` اختياري | يمنع مشاركة بيانات غير مقصودة بين الفروع | P6 وP7 / قبل P6 |
| `OD-ORG-02` | هل يمكن للمستخدم الانضمام إلى أكثر من Organization عند إطلاق SaaS؟ | يؤثر في identity وmembership وتبديل السياق | نعم مستقبلاً، مع Membership مستقلة لكل Organization | عضوية واحدة دائمة | global identity مع tenant memberships | فصل `users` عن `memberships` | يجب إعادة التحقق عند تبديل Organization | P3 وP5 وP6 / قبل P3 |
| `OD-ORG-03` | من يملك حق نقل ملكية Organization؟ | النقل إجراء عالي الخطورة | Owner الحالي بعد إعادة تحقق، مع قبول Owner الجديد | SystemAdministrator فقط؛ أو دعم يدوي | عملية backend خاصة ومهلة إلغاء | سجل ownership history | منع الاستحواذ على المؤسسة | P5 وP28 / قبل P5 |

## 3. Departments

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-DEP-01` | هل ينتمي الموظف إلى Department أساسي واحد أم عدة Departments؟ | يحدد النطاق الإداري والتقارير | Department أساسي واحد وعضويات مساعدة اختيارية | عدة عضويات متساوية | قواعد scope والتصفية | `primaryDepartmentId` مع memberships | يمنع تضارب صلاحيات المديرين | P7 وP8 / قبل P7 |
| `OD-DEP-02` | هل يستطيع DepartmentManager رؤية بيانات الأداء والحضور لكل أعضاء القسم أم التقارير التشغيلية فقط؟ | بيانات الموظفين حساسة | التشغيل والأحمال افتراضياً، والأداء/الحضور بصلاحيات منفصلة | وصول كامل؛ لا وصول | permissions مستقلة للتقارير وHR | تصنيف حقول وتقارير حساسة | تقليل الإفراط في الاطلاع | P5 وP21 وP23 وP24 / قبل P5 |

## 4. Teams

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-TEAM-01` | هل يمكن للموظف الانضمام إلى عدة Teams في الوقت نفسه؟ | شائع في الوكالات ويؤثر في السعة | نعم، مع Team أساسي ونسب سعة اختيارية | Team واحد فقط | membership وcapacity resolution | `allocationPercent` لكل عضوية | منع TeamLeader من تجاوز نطاق فريقه | P7 وP21 / قبل P7 |
| `OD-TEAM-02` | هل يستطيع TeamLeader إعادة إسناد مهمة إلى شخص خارج فريقه؟ | يحدد حدود الإدارة اليومية | لا؛ يطلب التحويل من مدير ذي نطاق أوسع | نعم داخل القسم؛ نعم داخل المؤسسة | authorization + transfer request | سجل reassignment وسبب | يمنع تجاوز الحدود التنظيمية | P5 وP12 / قبل P5 |

## 5. User roles

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-ROL-01` | هل `Admin` الحالي يقابل Owner أم GeneralManager أم دوراً مخصصاً؟ | لا يمكن ترحيل صلاحيات واسعة بالتخمين | مراجعة كل مستخدم Admin يدوياً قبل الترحيل | تحويل جماعي إلى GeneralManager؛ Owner | mapping migration | role assignments جديدة | يمنع منح ملكية أو صلاحيات زائدة | P5 وP8 / قبل P5 |
| `OD-ROL-02` | ما النطاق المقصود لدور `Manager` الحالي؟ | الاسم لا يكشف Department أو Team أو Organization | ترحيل مع scope صريح بعد مراجعة | DepartmentManager افتراضياً؛ TeamLeader | scope resolver | `scopeType` و`scopeId` | منع الوصول المؤسسي غير المقصود | P5 وP8 / قبل P5 |
| `OD-ROL-03` | كيف تُرحّل Dynamic custom roles الحالية؟ | identifiers الحالية لا تضمن معنى موحداً | تجميدها، استخراج الاستخدام، ثم إنشاء custom roles بصلاحيات صريحة | إسقاطها؛ مطابقة بالأسماء | migration review tool | permission snapshots | يمنع منح صلاحية اعتماداً على النص | P5 وP6 / قبل P5 |
| `OD-EMP-01` | هل يستطيع المدير تعطيل مستخدم فوراً أم يلزم اعتماد ثانٍ؟ | التعطيل يوقف الوصول والعمل | GeneralManager فما فوق؛ Owner يحتاج حماية من تعطيل نفسه | اعتماد ثنائي؛ SystemAdministrator فقط | privileged endpoint وإبطال جلسات | status reason وتاريخ | منع التعطيل التعسفي والحفاظ على التحقيق | P3 وP5 وP8 / قبل P3 |

## 6. Client access

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-CLI-01` | هل يرى Client User أسماء الموظفين المنفذين؟ | يؤثر في الخصوصية وتجربة العميل | يرى الاسم الأول والدور فقط عند الحاجة إلى التعاون | أسماء كاملة؛ أسماء الفريق فقط؛ لا أسماء | DTOs خاصة بالبوابة | حقول عرض منفصلة | منع كشف بيانات الموظف الداخلية | P5 وP27 / قبل P27 |
| `OD-CLI-02` | هل يرى العميل كل مهام المشروع أم عناصر منشورة له فقط؟ | المهام الداخلية قد تحتوي معلومات حساسة | عناصر معلّمة `clientVisible` فقط | كل المهام غير الداخلية؛ ملخصات فقط | query policy وpublishing action | visibility state | منع تسريب التشغيل الداخلي | P5 وP10 وP27 / قبل P10 |
| `OD-CLI-03` | هل يستطيع Client User دعوة جهات اتصال أخرى؟ | يفوض التحكم في الوصول خارج المؤسسة | ClientAdmin معيّن يمكنه طلب الدعوة؛ المؤسسة تعتمدها | دعوة مباشرة؛ المؤسسة فقط | invitation workflow | contact roles | يقلل إساءة توسيع الوصول | P3 وP9 وP27 / قبل P9 |

## 7. Project lifecycle

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-PRJ-01` | من يفتح Project ومن يعتمد بدءه؟ | يفصل البيع عن التنفيذ | `project.create` ينشئ Draft، و`project.manage` يفعّل | الإنشاء يفعّل فوراً؛ اعتماد مالي | state transition endpoint | approver/start dates | يمنع إطلاق مشروع بلا مسؤولية | P10 / قبل P10 |
| `OD-PRJ-02` | هل يمكن إعادة فتح Project مكتمل؟ | يؤثر في التقارير والفوترة وسلامة التاريخ | نعم بصلاحية خاصة وسبب، مع دورة إعادة فتح | ممنوع؛ إنشاء مشروع جديد | controlled transition | reopen events | منع تعديل تاريخ مكتمل بصمت | P10 وP24 / قبل P10 |
| `OD-FIN-01` | هل يتضمن V2 بيانات ميزانيات وأسعار وفواتير؟ ومن يراها؟ | يغير الحساسية والنطاق جذرياً | استبعاد الفوترة من أول إصدار؛ ميزانية داخلية اختيارية بصلاحية منفصلة | تضمين كامل؛ عدم تخزين أي مالية | modules وpermissions إضافية | حقول مالية مشفرة/مقيدة | خطر كشف بيانات تجارية | P10 وP24 / قبل P10 |

## 8. Task visibility

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-TSK-01` | هل يرى الموظف المهام المسندة لدوره أم المسندة إليه صراحة فقط؟ | الكود الحالي يخلط role-based assignment مع المستخدم | يرى ما أُسند إليه أو إلى Team مع عضوية فعالة؛ role queue بصلاحية صريحة | explicit فقط؛ كل مهام الدور | visibility resolver | assignment types | يمنع كشف مهام حساسة بالاسم الوظيفي | P5 وP12 / قبل P5 |
| `OD-TSK-02` | هل يرى الموظف كل مهام Project الذي هو عضو فيه؟ | العضوية لا تعني دائماً الحاجة للاطلاع | يرى `projectVisible` إضافة إلى assignments، مع دعم restricted | كل المشروع؛ assignments فقط | resource policy | `visibility` enum | يدعم least privilege | P5 وP12 / قبل P5 |
| `OD-TSK-03` | من يمكنه إعادة فتح Task مكتملة؟ | يحمي المقاييس والتاريخ | Manager ضمن النطاق أو approver، مع سبب وaudit | منشئ المهمة؛ أي assignee؛ ممنوع | transition rule | reopen cycle | يمنع العبث بالإنجاز | P12 وP15 / قبل P12 |

## 9. Task assignment

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-ASG-01` | هل تدعم المهمة عدة assignees مسؤولين بالتساوي أم assignee مسؤولاً واحداً ومساهمين؟ | يحدد المساءلة وحساب التأخير | assignee مسؤول واحد مع contributors | عدة مسؤولين؛ Team فقط | assignment validation | `assignmentRole` | يوضح المسؤول ولا يمنح صلاحيات مبهمة | P12 / قبل P12 |
| `OD-ASG-02` | هل يلزم قبول Contractor للمهمة قبل بدء SLA؟ | يؤثر في الموعد والمساءلة | نعم للمتعاون الخارجي؛ لا للموظف | قبول للجميع؛ لا قبول | accept/decline workflow | acceptedAt وdeclineReason | يمنع نسب التأخير قبل الالتزام | P12 وP21 / قبل P12 |

## 10. Workflow rules

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-WFL-01` | من يملك نشر Workflow Version؟ | النشر يغير العمليات المستقبلية | `workflow.publish` لمدير مخول، مع preview وتأكيد | Owner فقط؛ اعتماد ثنائي | publish endpoint | immutable version | يمنع تغيير سير العمل من منشئ عادي | P14 / قبل P14 |
| `OD-WFL-02` | هل تنتقل المهام النشطة إلى نسخة Workflow جديدة تلقائياً؟ | النقل قد يكسر الحالات القائمة | لا؛ تبقى pinned، والهجرة صريحة بخطة mapping | انتقال تلقائي؛ تطبيق على مهام مختارة | migration operation | version/stage mapping | يمنع انتقالات غير صالحة | P14 وP15 / قبل P14 |
| `OD-WFL-03` | هل يسمح Manual override بتجاوز checklists أو الملفات المطلوبة؟ | الاستثناء التشغيلي قد يقوض الضوابط | فقط بصلاحية خاصة وسبب؛ لا يتجاوز approval إلزامياً | لا override؛ تجاوز كامل للمدير | override policy | override record | تدقيق كل تجاوز | P15 / قبل P15 |
| `OD-WFL-04` | ماذا يحدث عند تجاوز SLA: تنبيه فقط أم escalation وإعادة إسناد؟ | يحدد الأتمتة والمسؤولية | تنبيه ثم escalation؛ لا إعادة إسناد تلقائية | إعادة إسناد؛ تمديد تلقائي | scheduled jobs | escalation history | يمنع تغيير المسؤول دون علمه | P15 وP20 وP25 / قبل P15 |

## 11. Approval rules

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-APR-01` | هل `Request changes` يعيد المرحلة نفسها أم ينشئ Review cycle جديداً؟ | يؤثر في التاريخ ومؤشرات الدوران | يعيد مرحلة rework وينشئ cycle جديداً مع ربط السابق | تعديل نفس الطلب؛ العودة لمرحلة محددة | workflow transition | review cycles | يحفظ القرار السابق بلا تعديل | P16 / قبل P16 |
| `OD-APR-02` | عند موافقات متعددة، هل المطلوب `ANY` أم `ALL` أم ترتيب محدد؟ | قاعدة تجارية لا يمكن استنتاجها | يحددها كل Approval Stage؛ الافتراضي `ALL` داخلياً | `ANY`؛ ordered | approval engine | policy snapshot | يمنع اعتماد ناقص | P14 وP16 / قبل P14 |
| `OD-APR-03` | هل يمكن تفويض الموافقة؟ ومن يعيّن المفوض؟ | الغياب قد يوقف العمل | تفويض مؤقت مع scope ومدة، يعتمد من manager | لا تفويض؛ تفويض ذاتي | delegation service | delegation records | يمنع تفويض دائم أو واسع | P5 وP16 / قبل P16 |
| `OD-APR-04` | ماذا يحدث عند انتهاء صلاحية موافقة العميل؟ | يؤثر في SLA والتسليم | escalation للمسؤول والعميل دون auto-approve | auto-reject؛ auto-approve؛ تعليق | scheduler | expiration events | يمنع موافقة صامتة | P16 وP20 وP27 / قبل P16 |

## 12. File retention

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-FIL-01` | ما مدة الاحتفاظ بالملفات المحذوفة قبل purge؟ | يؤثر في الاسترجاع والتكلفة والخصوصية | 30 يوماً، مع legal hold | 7/90 يوماً؛ حذف فوري لفئات معينة | cleanup jobs | `purgeAfter` وretention state | تقليل الاسترجاع غير المصرح وتسريب الروابط | P19 / قبل P19 |
| `OD-FIL-02` | هل يجب الاحتفاظ بكل File Version بعد اكتمال المشروع؟ | الإصدارات قد تكون دليل اعتماد | الاحتفاظ وفق سياسة المشروع، وحد أدنى للإصدارات المعتمدة | آخر نسخة فقط؛ كل النسخ دائماً | lifecycle policies | version retention | حماية الأدلة مع تقليل التعرض | P19 وP28 / قبل P19 |
| `OD-FIL-03` | ما أنواع الملفات والحد الأقصى للحجم؟ | ضروري للأمان والتكلفة | allowlist حسب الوحدة، و100 MB افتراضياً؛ الأكبر عبر مسار خاص | 25/500 MB؛ allow-all | upload validation/scanning | metadata/size | منع ملفات تنفيذية وإساءة التخزين | P19 / قبل P19 |

## 13. Comments

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-COM-01` | هل يمكن تعديل Comment بعد صدور Review/Approval مرتبط؟ | التعديل قد يغير سياق القرار | قفل المحتوى المرتبط؛ التصحيح بتعليق جديد | تعديل خلال 15 دقيقة؛ تعديل دائم مع versions | edit policy | comment versions | يحفظ سلامة القرار | P16 وP18 / قبل P16 |
| `OD-COM-02` | هل يستطيع Client إنشاء تعليقات داخلية؟ | الفصل بين القنوات أساسي | لا؛ فقط `clientVisible` في موارد مسموحة | اختيار visibility؛ قناة مشتركة فقط | separate commands/DTOs | visibility immutable | يمنع تسريب داخلي أو انتحال قناة | P18 وP27 / قبل P18 |

## 14. Time tracking

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-TIM-01` | هل Time tracking إلزامي لكل الموظفين والمهام؟ | يؤثر في التبني وجودة التقارير | قابل للضبط حسب Department/Project؛ غير إلزامي افتراضياً | إلزامي للجميع؛ اختياري دائماً | validation policies | requirement config | يمنع جمع زائد لبيانات الموظف | P22 / قبل P22 |
| `OD-TIM-02` | من يعدل Time Entry معتمدة؟ | التعديل يغير التقارير وربما الفوترة | صاحبها يطلب تصحيحاً؛ approver يعتمد نسخة معدلة | manager يعدل مباشرة؛ قفل نهائي | correction workflow | immutable approval history | يمنع التلاعب بالساعات | P22 وP24 / قبل P22 |

## 15. Attendance

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-ATT-01` | هل Attendance ضمن أول Production Release؟ | يتطلب قواعد محلية وخصوصية إضافية | ضمن Management Release بعد اعتماد السياسات، لا Core Release | تأجيله؛ إطلاقه مبكراً | roadmap gating | سجلات حضور حساسة | يتطلب وصول HR دقيقاً | P23 / قبل P21 |
| `OD-ATT-02` | ما مصدر الحضور: إدخال يدوي، جهاز، موقع، أم تكامل HR؟ | لا يمكن بناء التحقق دون مصدر | إدخال/تصحيح معتمد أولاً، ثم integration | GPS؛ biometric؛ device API | adapter + reconciliation | source/evidence fields | GPS/biometric عالي الحساسية | P23 وP28 / قبل P23 |

## 16. Leave

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-LEV-01` | من يعتمد Leave Request، وهل تختلف السلسلة حسب النوع أو المدة؟ | قاعدة موارد بشرية أساسية | TeamLeader ثم DepartmentManager للمدد الطويلة؛ configurable | مدير مباشر فقط؛ HR نهائي | approval policy | approval steps | منع اعتماد ذاتي وتجاوز النطاق | P23 / قبل P23 |
| `OD-LEV-02` | هل تُدار الأرصدة داخل ZAMAM أم تُقرأ من نظام HR؟ | يمنع ازدواج مصدر الحقيقة | ZAMAM يديرها فقط إن لم يوجد HR authoritative | read-only integration؛ بلا أرصدة | ledger/integration | balance ledger | يمنع تعديل رصيد غير مصرح | P23 وP26 / قبل P23 |

## 17. Performance metrics

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-MET-01` | كيف يُنسب التأخير عند انتظار عميل أو reviewer أو dependency؟ | يمنع تقييم الموظف ظلماً | فترات delay attribution منفصلة تستبعد الانتظار غير المنسوب للمنفذ | الموعد النهائي وحده؛ attribution يدوي فقط | event-derived metrics | delay intervals/reasons | يحد من قرارات أداء مضللة | P15 وP24 / قبل P15 |
| `OD-MET-02` | من يرى تقارير أداء الفرد؟ | بيانات وظيفية حساسة | الفرد، مديره ضمن النطاق، وHR/Owner بصلاحية صريحة | كل المديرين؛ المؤسسة كلها | report authorization | audience policy | تقليل كشف الأداء | P5 وP24 / قبل P5 |
| `OD-SLO-01` | ما القيم المستهدفة لـ SLA ومؤشرات النجاح لكل نوع عمل؟ | لا يمكن تقييم التحسن بلا baseline | إعدادها لكل Workflow بعد 4 أسابيع baseline | أهداف موحدة؛ أهداف فورية | SLA config | target histories | لا أثر مباشر، لكن النتائج حساسة | P15 وP24 / قبل P15 |

## 18. Notifications

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-NOT-01` | ما القنوات المطلوبة عند الإطلاق، وما الأحداث غير القابلة للكتم؟ | يؤثر في التكلفة والضوضاء والاستجابة | In-app وemail؛ أحداث الأمن والموافقة الحرجة غير قابلة للكتم | WhatsApp/SMS؛ in-app فقط | provider adapters/preferences | delivery attempts | منع تسريب محتوى حساس في قناة خارجية | P20 / قبل P20 |
| `OD-NOT-02` | هل ترسل الإشعارات الخارجية تفاصيل المهمة أم رابطاً عاماً فقط؟ | البريد قد يُعاد توجيهه | عنوان آمن وملخص محدود ورابط مصادق | تفاصيل كاملة؛ تنبيه بلا عنوان | template policy | redaction flags | تقليل تسرب البيانات | P20 وP27 / قبل P20 |

## 19. Automations

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-AUT-01` | ما الإجراءات التي يمكن لـ Automation تنفيذها دون موافقة بشرية؟ | التنفيذ الآلي قد يغير بيانات حساسة | إجراءات منخفضة المخاطر فقط؛ لا حذف أو صلاحيات أو موافقات | proposal-only؛ allowlist أوسع | action registry/policy | run/action audit | يمنع تصعيد صلاحيات آلي | P25 / قبل P25 |
| `OD-AUT-02` | هل تعمل Automation بصلاحيات المنشئ أم Service Principal محدود؟ | يحدد الاستمرارية والمساءلة | Service Principal محدود مع owner وscope | صلاحيات المنشئ؛ صلاحيات النظام | execution identity | principal snapshot | يمنع تجاوز النطاق بعد تغير المنشئ | P5 وP25 / قبل P25 |

## 20. AI

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-AI-01` | هل AI يقترح الإجراءات فقط أم ينفذ إجراءات منخفضة المخاطر تلقائياً؟ | أهم حد سلامة للذكاء الاصطناعي | proposal-only في الإصدار الأول؛ تنفيذ محدود بعد قياس | تنفيذ allowlist مع confirmation؛ autonomous | AI action approval layer | proposal/decision records | يمنع الكتابات غير المقصودة | P26 / قبل P26 |
| `OD-AI-02` | ما أنواع البيانات المسموح إرسالها إلى مزود AI؟ | قد تشمل بيانات عميل وموظف | deny by default؛ redaction وتصنيف وموافقة Organization | كل محتوى؛ بيانات عامة فقط | policy gateway/DLP | consent/classification | يمنع تسريب البيانات لطرف ثالث | P26 وP28 / قبل P26 |

## 21. Integrations

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-INT-01` | ما مزود التخزين المعتمد: Firebase Storage أم R2 أم Google Drive؟ | النموذج الحالي يحتوي مسارات غير موحدة | abstraction موحد؛ اختيار مزود أساسي واحد بعد مقارنة التكلفة والامتثال | تخزين متعدد منذ البداية | FileService adapters | canonical object metadata | توحيد signed access وفصل الأسرار | P19 / قبل P19 |
| `OD-INT-02` | ما أول تكاملات مطلوبة فعلياً بعد الإطلاق؟ | يمنع بناء adapters غير مستخدمة | email أولاً، ثم calendar/storage حسب حاجة مؤكدة | Drive/WhatsApp/Slack مبكراً | roadmap prioritization | integration configs | كل تكامل يوسع سطح الهجوم | P20 وP25 وP28 / قبل P20 |
| `OD-INT-03` | هل تقبل Webhooks واردة من أطراف ثالثة، وما المزودون؟ | يتطلب توقيعاً وإعادة إرسال وتحديد معدلات | لا endpoint عام قبل مزود محدد وعقد توقيع | generic webhook ingress | verification adapters | receipt/idempotency records | منع spoofing وreplay | P25 وP28 / قبل P25 |

## 22. Data retention

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-RET-01` | كم سنة تُحتفظ Audit Events؟ | يؤثر في التحقيق والتكلفة والامتثال | 7 سنوات للأحداث الحساسة، وقابلية ضبط حسب الالتزام | 1/3 سنوات؛ غير محدد | partition/export lifecycle | retention class | الحفاظ على الأدلة مع تقييد الوصول | P6 وP28 / قبل P6 |
| `OD-RET-02` | ما مدة الاحتفاظ بالمهام والمشاريع المؤرشفة؟ | تؤثر في التقارير والحذف | 5 سنوات افتراضياً ثم export/purge وفق العقد | دائم؛ 1/7 سنوات | archival jobs | retention metadata | تقليل البيانات القديمة | P6 وP28 / قبل P6 |
| `OD-RET-03` | كيف تُنفذ طلبات حذف بيانات User/Client مع وجود audit وlegal hold؟ | تعارض الخصوصية مع سلامة السجل | anonymize PII مع إبقاء identifiers غير القابلة للعكس والأدلة المطلوبة | حذف كامل؛ احتفاظ كامل | deletion orchestration | tombstones/anonymization map | منع إعادة التعرف | P6 وP28 / قبل P6 |
| `OD-RET-04` | ما أهداف `RPO` و`RTO` المطلوبة؟ | تحدد استراتيجية النسخ والاستعادة | Owner يحددها بعد تقييم تكلفة؛ baseline مقترح RPO 24h/RTO 8h | أكثر صرامة أو أقل | backup frequency/runbooks | backup generations | يقلل فقد البيانات وفترة التعطل | P28 / قبل P28 |

## 23. Security

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-SEC-01` | هل MFA إلزامي للأدوار الإدارية؟ | الحساب الإداري عالي الأثر | إلزامي لـ Owner وGeneralManager وSystemAdministrator | موصى به فقط؛ إلزامي للجميع | auth claims/session policy | MFA enrollment state | يخفض خطر الاستيلاء | P3 وP28 / قبل P3 |
| `OD-SEC-02` | ما مدة الجلسة، وهل يلزم re-auth للإجراءات الحساسة؟ | الجلسات الطويلة تزيد المخاطر | session قصيرة نسبياً مع re-auth للملكية والصلاحيات والتكاملات | مدة طويلة؛ re-auth لكل إدارة | session enforcement | security event records | يحد من إساءة الجلسة المسروقة | P3 وP5 / قبل P3 |
| `OD-PRV-01` | ما المتطلبات القانونية والخصوصية بحسب دول التشغيل؟ | الحضور والأداء وAI تخضع لقوانين مختلفة | تحديد الدول ومستشار قانوني قبل Management/AI releases | سياسة عامة فقط | regional config/consent | residency/retention | خطر امتثال وعقوبات | P23 وP26 وP28 / قبل P23 |

## 24. SaaS readiness

| ID | السؤال المحدد | سبب الأهمية | Recommended default | البدائل | Technical impact | Data impact | Security impact | يعتمد عليه / الموعد |
|---|---|---|---|---|---|---|---|---|
| `OD-SAA-01` | هل يُسمح لـ SystemAdministrator بالدخول إلى بيانات Organization للدعم؟ | دعم SaaS قد يتطلب وصولاً استثنائياً | لا وصول افتراضي؛ time-bound break-glass بموافقة وتدقيق | وصول دائم؛ لا وصول مطلقاً | support access workflow | access grants/audit | أعلى مخاطر الوصول الداخلي | P5 وP28 / قبل P5 |
| `OD-SAA-02` | هل يلزم data residency أو عزل مادي لبعض العملاء مستقبلاً؟ | قد يغير بنية الاستضافة | tenant-aware منطقي الآن؛ عزل مادي كخيار enterprise لاحق | قاعدة مشتركة فقط؛ عزل من البداية | deployment topology | tenant placement | يدعم التزامات العملاء | P6 وP28 / قبل P6 |
| `OD-SAA-03` | هل Billing وsubscription management جزء من V2؟ | يؤثر في الـ SaaS domain لكنه ليس تشغيل وكالة | خارج أول إنتاج؛ تصميم entitlement extension point فقط | تضمين billing؛ تشغيل داخلي دائم | module boundary | plan/entitlement future fields | حماية بيانات الدفع وتجنب نطاق زائد | P28 وما بعده / قبل P28 |

## 25. آلية إغلاق القرارات

لكل قرار يجب إضافة سجل اعتماد خارج هذا الملف أو عبر Pull Request موثق يتضمن: `decisionId`، القرار المختار، صاحب القرار، تاريخ السريان، الاستثناءات، والـ prompts المتأثرة. عند تغيير قرار بعد بدء التنفيذ يجب:

1. إجراء impact analysis على schema وpermissions وworkflows وmigration.
2. إصدار Architecture Decision Record عند التأثير الهيكلي.
3. تحديث المستندات المتقاطعة قبل تعديل الكود.
4. إضافة migration أو compatibility plan إذا أصبحت بيانات منشورة متأثرة.
5. عدم تطبيق القرار بأثر رجعي على approvals أو audit history المنشورة.
