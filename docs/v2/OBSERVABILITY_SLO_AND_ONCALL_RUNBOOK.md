# Observability وSLO وOn-call

## إشارات الخدمة

| الإشارة | SLI | تنبيه مبدئي |
|---|---|---|
| API availability | responses غير 5xx / الكل | أقل من 99.9% خلال 30 دقيقة |
| API latency | P50/P75/P95 حسب operation | P95 أكثر من 1s للcommands القصيرة |
| Worker health | completed/retry/DLQ | DLQ > 0 أو retry ratio > 5% |
| Workflow | transition success/conflict | فشل غير business > 1% |
| Notifications | delivery lag/failure | lag > 10 دقائق |
| Files | scan backlog/quarantine | backlog > 30 دقيقة |
| Automation/AI | quota/cost/provider failures | burst أو budget breach |
| Data | migration/reference/backup checks | أي mismatch |

الأهداف الأولية تحتاج baseline لأربعة أسابيع قبل اعتمادها التعاقدي.

## Logging

كل request يحمل correlation ID وoperation وactor ID غير حساس وoutcome/latency. `createLogger` يحجب مفاتيح token/password/secret/credential. يمنع تسجيل request bodies وPII وAI content وsigned URLs. Audit events append-only وليست بديلاً عن operational logs.

## On-call

P1: disclosure/data loss/security أو core outage. أوقف feature/cohort، ابطل sessions/grants، احفظ الأدلة، وأبلغ Security/Data Owner. P2: degraded queue/provider؛ استخدم retry/DLQ runbook. P3: isolated UX/report issue.

كل تنبيه يحتاج owner، dashboard، runbook، correlation sample، وآلية silence محددة المدة. اختبر alert routing في staging؛ لا ترسل رسائل حقيقية في local tests.
