# Autonomous Test Matrix

Latest additions: P13 query/scope/search/saved views 6 passed; board/save-view UI assertions added to task UI suite.

| Prompt | المستوى | النطاق | الحالة |
|---:|---|---|---|
| Baseline | build/lint/manual smoke | V1 | build pass؛ lint 52 fail؛ no tests |
| P2 | structural unit | workspace paths وFirebase hosting | 10 pass |
| P2 | static | typecheck + lint | pass |
| P2 | production build | web bundle | pass مع chunk warning |
| P3 | unit | session decisions، revoked token، disable/reset service | 8 pass |
| P3 | DOM integration | anonymous/inactive/active route guard | 3 pass |
| P3 | browser smoke | login، reset، invalid invite، workspace redirect | pass؛ screenshots في `docs/v2/evidence/p3` |
| P3/P6 | emulator | Firestore deny-default، self session view، forged claims، cross-tenant | 4 pass على emulator فعلي |
| P4 | contract/local integration | envelope، validation، auth/App Check، CORS، idempotency، outbox | 7 pass |
| P4 | unit | redaction، worker completion/retry/dead-letter | 3 pass |
| P4 | runtime smoke | compiled Functions/worker imports + `/health` | pass |
| P5 | policy matrix | 10 roles cross-tenant + disabled، scope/deny/client/platform/step-up | 47 pass |
| P5 | service/static rules | role assignment anti-escalation/version/audit + Firestore default deny | 5 pass |
| P5 | runtime smoke | compiled authorization catalog/defaults/legacy mapping | pass |
| P6 | schema/converter | 60 tenant entities، timestamps، immutable/version rules، pagination | 67 table-driven checks ضمن suite ناجحة |
| P6 | repository/data rehearsal | backup checksum/count/tenant، restore، migration dry-run/write/quarantine/rollback | pass |
| P6 | audit transaction | permission coverage 100%، append/outbox/idempotency، rollback/failure event | pass |
| P6 | accessibility | login/reset/invitation axe checks | 3 pass |
| P6 | clean-install gate | `npm ci` ثم typecheck/lint/unit/build/bundle/emulator | pass؛ 160 unit/integration + 4 rules |
| P6 | performance budget | bounded query limit + web JS/image artifact budgets | pass؛ entry 8.2 KB، max JS 345.8 KB |
| P7 | domain/service | organization settings/suspend، department/team uniqueness/archive، membership allocation/idempotency | 8 pass |
| P7 | RTL UI/accessibility | hierarchy، capability feedback، empty state، create command flow، axe | 3 pass |
| P8 | employee lifecycle | invitation/compensation، last Owner، session revoke، multi-tenant identity، departure cleanup، schedules/PII | 9 pass |
| P8 | RTL UI/accessibility | sanitized directory، invite without role، sensitive disable confirmation، axe | 3 pass |
| P9 | client lifecycle/security | tenant isolation، AES-GCM/HMAC، no portal grant، eligibility/revoke/archive، projections | 7 pass |
| P9 | RTL UI/accessibility | list/detail، contact without invitation، separate eligibility، axe | 3 pass |

يُوسّع الجدول عند بدء كل Prompt، ولا يُعتبر Prompt مكتملاً دون evidence قابل للتكرار.
