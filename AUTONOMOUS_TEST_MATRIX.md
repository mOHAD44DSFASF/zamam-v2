# Autonomous Test Matrix

| Prompt | المستوى | النطاق | الحالة |
|---:|---|---|---|
| Baseline | build/lint/manual smoke | V1 | build pass؛ lint 52 fail؛ no tests |
| P2 | structural unit | workspace paths وFirebase hosting | 10 pass |
| P2 | static | typecheck + lint | pass |
| P2 | production build | web bundle | pass مع chunk warning |
| P3 | unit/integration/E2E | session, invitation, reset, disabled user | pending |
| P4 | unit/integration | backend envelope, validation, idempotency | pending |
| P5 | policy matrix/property tests | tenant and resource authorization | pending |
| P6 | converter/emulator/audit tests | canonical schema and outbox | pending |

يُوسّع الجدول عند بدء كل Prompt، ولا يُعتبر Prompt مكتملاً دون evidence قابل للتكرار.
