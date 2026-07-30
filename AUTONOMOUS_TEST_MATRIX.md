# Autonomous Test Matrix

| Prompt | المستوى | النطاق | الحالة |
|---:|---|---|---|
| Baseline | build/lint/manual smoke | V1 | build pass؛ lint 52 fail؛ no tests |
| P2 | structural unit | workspace paths وFirebase hosting | 10 pass |
| P2 | static | typecheck + lint | pass |
| P2 | production build | web bundle | pass مع chunk warning |
| P3 | unit | session decisions، revoked token، disable/reset service | 8 pass |
| P3 | DOM integration | anonymous/inactive/active route guard | 3 pass |
| P3 | browser smoke | login، reset، invalid invite، workspace redirect | pass؛ screenshots في `docs/v2/evidence/p3` |
| P3 | emulator | fixtures/config complete؛ execution deferred لعدم توفر Java محلياً | partial؛ Auth emulator لا يكفي Firestore rules |
| P4 | contract/local integration | envelope، validation، auth/App Check، CORS، idempotency، outbox | 7 pass |
| P4 | unit | redaction، worker completion/retry/dead-letter | 3 pass |
| P4 | runtime smoke | compiled Functions/worker imports + `/health` | pass |
| P5 | policy matrix/property tests | tenant and resource authorization | pending |
| P6 | converter/emulator/audit tests | canonical schema and outbox | pending |

يُوسّع الجدول عند بدء كل Prompt، ولا يُعتبر Prompt مكتملاً دون evidence قابل للتكرار.
