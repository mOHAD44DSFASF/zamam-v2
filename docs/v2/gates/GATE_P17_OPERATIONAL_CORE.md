# Gate P17: Operational Core

النتيجة: **PASS** في 2026-07-30. التحقق محلي وعلى Firestore emulator فقط، ولم تلمس بيانات production.

| البوابة | الدليل القابل للإعادة | النتيجة |
|---|---|---|
| Security | `authorization-engine.test.ts` يختبر scopes والعزل وclient visibility؛ `review-approval.test.ts` يمنع client/internal leakage؛ `template.publish` يتطلب step-up؛ Firestore rules emulator 5/5 | PASS |
| Data | workflow versions منشورة وغير قابلة للتعديل؛ task instance مثبت إلى version؛ stage/review/approval/recurrence histories دائمة؛ `recurrence_run` حتمي؛ V1 task mapping staging-only مع quarantine/rollback | PASS |
| Tests | `npm.cmd run check`: 31 files و286 tests؛ workflow graph/execution، approval policies، recurrence DST/dedupe، RTL UI/axe؛ emulator 5/5 | PASS |
| Performance | task/due recurrence queries محدودة 50 وبـ cursor؛ SLA/queue scans مرتبة؛ web bundle budgets نجحت، entry 11.84 KB وFirebase chunk 345.83 KB | PASS |
| Documentation | أمثلة workflow والنسخ في `WORKFLOW_SPECIFICATION.md`؛ التنفيذ في `WORKFLOW_IMPLEMENTATION.md`؛ recurrence runbook في `TEMPLATE_RECURRENCE_POLICY.md`؛ migration/rollback موثقان | PASS |

## فحوص شروط الإيقاف

- **Lost history:** غير موجود؛ كل transition وreview decision وrecurrence occurrence له سجل append-only/audit.
- **Duplicate transition/run:** محمي بـ idempotency، expected version، transaction، ومعرف occurrence حتمي.
- **Mutable approval evidence:** غير مسموح؛ القرار مثبت إلى `reviewedVersion` وhash، والتعديل بعده ينشئ دورة جديدة.
- **Cross-tenant أو client leakage:** مرفوض في authorization engine وFirestore rules.
- **Unbounded scheduler/task query:** مرفوض بحد أقصى 50؛ catch-up محدود بعشرة occurrences.

## مخاطر مراقبة

- تركيب adapters الفعلية لمسارات HTTP الخاصة بالميزات ما زال مطلوبًا قبل P28؛ registry يرفض غير المسجل fail-closed.
- لا توجد بيانات staging حقيقية في هذا التحقق. أي orphan أو legacy role مبهم أثناء rehearsal الفعلي يحول القرار إلى **STOP**.
- queue age/write cost لا يمكن قياسهما إنتاجيًا الآن؛ الحدود والبنية قابلة للقياس، والقياس الحملي الإلزامي في P28.

## قرار المتابعة

**Proceed إلى Prompt 18.** لا يوجد شرط STOP مثبت في البيئة المحلية.
