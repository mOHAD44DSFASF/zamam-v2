# القرارات المعتمدة للتنفيذ الذاتي

## مصدر الاعتماد

اعتمد المالك جميع قيم `Recommended default` في `OWNER_DECISIONS.md`. يشمل ذلك 63 قراراً:

`OD-AI-01`, `OD-AI-02`, `OD-APR-01`, `OD-APR-02`, `OD-APR-03`, `OD-APR-04`, `OD-ASG-01`, `OD-ASG-02`, `OD-ATT-01`, `OD-ATT-02`, `OD-AUT-01`, `OD-AUT-02`, `OD-CLI-01`, `OD-CLI-02`, `OD-CLI-03`, `OD-COM-01`, `OD-COM-02`, `OD-DEP-01`, `OD-DEP-02`, `OD-EMP-01`, `OD-FIL-01`, `OD-FIL-02`, `OD-FIL-03`, `OD-FIN-01`, `OD-INT-01`, `OD-INT-02`, `OD-INT-03`, `OD-LEV-01`, `OD-LEV-02`, `OD-MET-01`, `OD-MET-02`, `OD-NOT-01`, `OD-NOT-02`, `OD-ORG-01`, `OD-ORG-02`, `OD-ORG-03`, `OD-PRJ-01`, `OD-PRJ-02`, `OD-PRV-01`, `OD-RET-01`, `OD-RET-02`, `OD-RET-03`, `OD-RET-04`, `OD-ROL-01`, `OD-ROL-02`, `OD-ROL-03`, `OD-SAA-01`, `OD-SAA-02`, `OD-SAA-03`, `OD-SEC-01`, `OD-SEC-02`, `OD-SLO-01`, `OD-TEAM-01`, `OD-TEAM-02`, `OD-TIM-01`, `OD-TIM-02`, `OD-TSK-01`, `OD-TSK-02`, `OD-TSK-03`, `OD-WFL-01`, `OD-WFL-02`, `OD-WFL-03`, `OD-WFL-04`.

## قرارات Master Goal الصريحة ونتائجها

| القرار | المصدر | نتيجة التنفيذ |
|---|---|---|
| Tenant واحد لكل Organization مع branches اختيارية وidentity متعددة العضوية | `OD-ORG-01/02` | كل سجل tenant-owned يحمل `organizationId` والعزل cross-tenant deny |
| Legacy Admin لا يصبح Owner | `OD-ROL-01/02/03` | mapping إلى `GeneralManager` في preview فقط، والحالات الغامضة quarantine |
| Hybrid Functions 2nd gen + Cloud Run | Master Goal §4.3 | عمليات privileged backend-only وعقود مستقلة عن النقل |
| Firestore operational store | Master Goal §4.4 | converters، UTC server timestamps، transaction، idempotency، outbox، audit append-only |
| Cloudflare R2 خلف `FileService` | `OD-INT-03`, `OD-FIL-*` | private objects وsigned operations؛ fake محلي |
| in-app notifications + provider-neutral email | `OD-NOT-*` | capture provider محلي؛ لا رسائل حقيقية |
| Search abstraction | Master Goal §4.7 | بحث bounded محلي/Firestore مع adapter خارجي لاحقاً |
| AI proposal-only | `OD-AI-01/02` | mock/disabled mode؛ منع الإجراءات عالية المخاطر |
| Automation service principal محدود | `OD-AUT-01/02` | allowlist منخفض المخاطر، والباقي human proposal |
| سياسات privacy/retention قابلة للضبط | `OD-PRV-01`, `OD-RET-*` | لا ادعاء امتثال قانوني قبل review |
| Audit 7 سنوات، archives 5 سنوات، deleted files 30 يوماً | `OD-RET-*`, `OD-FIL-01` | retention jobs وlegal hold وRPO 24h/RTO 8h |
| Billing/payroll/accounting خارج النطاق | `OD-FIN-01` | extension points فقط |
| Attendance يدوي وتصحيح معتمد أولاً | `OD-ATT-01/02` | لا GPS أو biometrics |
| SLA قابل للضبط؛ KPI targets بعد baseline أربعة أسابيع | `OD-SLO-01`, `OD-MET-*` | لا أرقام أداء مخترعة |
