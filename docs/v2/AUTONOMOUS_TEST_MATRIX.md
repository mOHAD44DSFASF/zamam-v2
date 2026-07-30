# Autonomous Test Matrix

| Gate/Prompt | التغطية | النتيجة |
|---|---|---|
| P6 | auth/backend/RBAC/schema/audit/migration/rules | PASS |
| P11 | workspace membership/tenant/migration/rules | PASS |
| P17 | tasks/workflow/review/templates/recurrence | PASS |
| P20 | comments/files/notifications/delivery | PASS |
| P24 | workload/time/attendance/leave/KPI/export | PASS |
| P25 | automation allowlist/loop/quota/retry/UI | 6 PASS |
| P26 | AI redaction/injection/hash/retention/disabled/UI | 8 PASS |
| P27 | portal cross-client/org/leakage/request/UI | 7 PASS |
| P28 static/runtime | route coverage، public auth، App Check clients، headers/indexes/CI/backup/artifact | 9 PASS |
| Full suite | 56 files | 407/407 PASS |
| Firestore emulator | deny-default/session/forged/cross-tenant | 5/5 PASS |
| Browser | previous P3 evidence only؛ final attempt blocked by approval quota | BLOCKED |
| Production-like load/DR/penetration | needs staging/external authority | NOT RUN |

السجل التاريخي الموسع موجود في `/AUTONOMOUS_TEST_MATRIX.md`.
