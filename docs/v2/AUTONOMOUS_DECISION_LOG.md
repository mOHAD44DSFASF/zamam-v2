# Autonomous Decision Log

| ID | القرار | الأثر |
|---|---|---|
| AD-001 | عدم تثبيت أسرار V1 في Git | env/secret provider فقط |
| AD-002 | فرع `codex/zamam-v2-autonomous` وbaseline archive | checkpoints قابلة للاستعادة |
| AD-004 | الاستمرار من recovery workspace بعد اختفاء `F:` | لا كتابة فوق نسخة مجهولة |
| AD-005 | عدم downgrade آلي لـReact Router | advisory triage وإعادة فحص قبل GO |
| AD-007 | `/workspace` يعيد إلى `/tasks` V2 | V1 direct Firestore UI غير reachable |
| AD-008 | App Check token عبر SDK في production | لا emulator-only header |
| AD-009 | Firestore persistent API idempotency/rate/outbox | آمن لتعدد Function instances |
| AD-010 | Functions deploy artifact مستقل | workspace deps bundled؛ لا deploy في هذا التشغيل |
| AD-011 | Gate 28 = STOP | uncomposed handlers + external security/legal/authority |
