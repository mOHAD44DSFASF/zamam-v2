# Autonomous Test Matrix

Latest additions: P28 route coverage, App Check clients, persistent API controls, headers/indexes/CI, backup corruption, Functions artifact, and enforced predeploy STOP. Full suite 56 files, 407/407; emulator 5/5. Gate P28 remains STOP because launch assurance and runtime composition are incomplete.

| P28 Gate | clean install/type/lint/unit/integration/UI/build/bundle/artifact/emulator | 407 tests + 5 emulator PASS; Gate STOP |
| P28 | production-readiness invariants | V1 route unreachable, all feature clients App Check, rules/indexes/headers/CI/backup/artifact | 5 pass |
| P28 | API route coverage | 65 web paths registered, public-auth App Check, fail-closed uncomposed backend | 3 pass |
| P28 | browser/device smoke | managed approval quota prevented final launch | BLOCKED |
| P28 | production-like load/DR/penetration/legal/authority | external staging and accountable approvals required | NOT RUN |

Latest additions: P25 automation 6؛ P26 AI 7؛ P27 portal 7. Full suite 397/397؛ emulator 5/5؛ Gate P27 PASS.

| P27 Gate | client experience | cross-org/client denial، strict projection، portal request audit، RTL/axe، full check/build/bundle، 397 tests، 5 emulator | PASS |
| P27 | portal backend/security | identity/status/client account، explicit project membership، no internal payload، request audit | 5 pass |
| P27 | portal RTL/accessibility | dashboard/project/signed-download command، Arabic + English content smoke، axe | 2 pass |
| P26 | AI safety/backend | redaction، injection، SHA-256 evidence، disabled provider، quota/time bounds، proposal-only | 5 pass |
| P26 | AI RTL/accessibility | disabled state، human decision، no execute action، axe | 2 pass |
| P25 | automation RTL/accessibility | bounded policy، pause/resume capability، traceable run/error، axe | 1 pass |

| P25 | automation engine | allowlist/loop denial، dedupe، least-privilege action permission، depth/quota، retry/DLQ، condition skip | 5 pass |

| P24 Gate | full management data | security matrix، reconciliation، formula lineage، export bounds، typecheck/lint/build/bundle، 375 tests، 5 emulator | PASS |

| P24 | metric/service/security | fixed formulas، no-data، attribution، deterministic lineage، performance scope، export whitelist/step-up | 4 pass |
| P24 | export worker | row/field bounds، CSV injection، minimized async handoff | 2 pass |
| P24 | RTL UI/accessibility | sensitive metric hiding، lineage، server-advertised export fields، axe | 2 pass |

| P23 | domain/service/security | holiday priority، manual attendance، correction evidence، leave overlap، ordered approval، balance ledger، external HR fail-closed | 6 pass |
| P23 | RTL UI/accessibility | self attendance/leave، explicit request، no team leakage، axe | 2 pass |

| P22 | domain/service/security | rounding، timezone، half-open overlap، idempotent timer، future denial، atomic submit/approve، self approval، immutable correction | 7 pass |
| P22 | RTL UI/accessibility | self entries، start command، explicit period submit، billable redaction، axe | 3 pass |

| P21 | domain/service/privacy | part-time، leave/holiday deduction، overlap، unknown schedule/estimate، overload، scoped audited projection، bounded query | 7 pass |
| P21 | RTL UI/accessibility | explainable capacity، unknown warning، rebuild boundary، name redaction، axe | 3 pass |

| P20 | domain/service/security | outbox projection، audience access، minimized payload، deterministic dedupe، critical override، quiet hours، bounded queries | 7 pass |
| P20 | delivery/provider | digest grouping، safe locale content، SHA-256 idempotency، retry، DLQ، mocked Resend 429 | 4 pass |
| P20 | RTL UI/accessibility | inbox status، preferences، provider fail-closed، axe | 3 pass |
| P20 Gate | full quality | typecheck، lint، 333 tests، build/bundle، 5 emulator rules، secret-pattern scan | PASS |

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
| P10 | domain/service | project lifecycle، membership، client scope، financial projection | pass |
| P10 | RTL UI/accessibility | project list/details/actions، capability states، axe | pass |
| P11 | domain/migration | workspace membership، tenant context، deterministic inventory/quarantine/rollback | 13 pass |
| P11 | emulator/security gate | forged claims، tenant isolation، recursive client-write deny | 5 pass |
| P12 | domain/service | task lifecycle، optimistic concurrency، assignments، subtasks/checklists | pass |
| P12 | RTL UI/accessibility | create/edit/details and capability states | pass |
| P13 | query/service/UI | bounded scoped task queries، search boundary، saved/URL views | pass |
| P14 | workflow definition | graph validation، simulation، immutable publication، step-up | pass |
| P14 | RTL UI/accessibility | builder load/edit/simulate/publish states، axe | pass |
| P15 | workflow execution | pinned version، exactly-once transition، rework، SLA، history | pass |
| P16 | review/approval | 4 policies، stale evidence، delegation، expiry، client boundary | 9 pass |
| P16 | RTL UI/accessibility | review evidence and decision flow، axe | 2 pass |
| P17 | template/recurrence | publish step-up، DST، catch-up bound، deterministic run، pause/resume/query | 8 pass |
| P17 | RTL UI/accessibility | inventory، create command، permission states، axe | 2 pass |
| P17 Gate | full quality | typecheck، lint، 286 tests، build، bundle، 5 emulator rules | PASS |
| P18 | domain/service/security | normalization، client leakage، mentions، edit lock/window، tombstone، reactions/watchers، bounded queries | 10 pass focused |
| P18 | RTL UI/accessibility | channel selection، explicit mentions، portal channel absence، axe | 3 pass focused |
| P19 | domain/service/security | type/size/checksum/key، prepare/finalize، clean-only download، quarantine، versions، retention/purge | 9 pass |
| P19 | background processing | scanner configuration/evidence، retry-compatible purge handoff | 3 pass |
| P19 | provider contract | deterministic R2 SigV4 PUT/GET/HEAD/DELETE، expiry، no network | 4 pass |
| P19 | RTL UI/accessibility | library/upload، integration-not-configured fail-closed، axe | 3 pass |
| P19 | full quality | typecheck، lint، 318 tests، production build، bundle budget | PASS |

يُوسّع الجدول عند بدء كل Prompt، ولا يُعتبر Prompt مكتملاً دون evidence قابل للتكرار.
