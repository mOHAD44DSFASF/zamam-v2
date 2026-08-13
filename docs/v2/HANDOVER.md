# ZAMAM V2 — Developer Handover

Read time: ~10–15 minutes. This is the single entry point for a new developer picking up
deployment and production setup. Everything below was spot-checked against the actual codebase
on 2026-08-08, not copied from memory of prior sessions.

## 1. Project Overview

ZAMAM V2 is an internal, Arabic-first operations tool for an agency/services company: it tracks
organizations, departments, teams, employees, clients, projects, and — at its center — **tasks
that move through an ordered pipeline of steps**, each step assigned to a person or a department,
advancing `pending → in_progress → done` (or sent back to any earlier step with a required
reason). Access is governed by a role-based permission system (`Owner`, `GeneralManager`,
`Manager`, `DepartmentLead`, `TeamLeader`, `Supervisor`, `Employee`, `Contractor`, `Client`,
`SystemAdministrator` — see `packages/authorization/src/default-roles.ts`), with dashboards and
notifications scoped to what each role should see. It is not a generic task manager: it links who
requested work, who owns/executes/reviews it, files/comments/approvals attached to it, and an
append-only audit trail explaining every sensitive change. Full product framing (in Arabic):
`docs/v2/PRODUCT_BLUEPRINT.md`.

## 2. Current State — Fully Built, Tested, Verified Live

Everything below has been exercised live via Playwright against the local emulator (not just
unit-tested), except where noted.

- **Auth & bootstrap**: Firebase Auth (email/password) via the emulator; no self-service org
  creation by design — the first Owner is created out-of-band via `npm run bootstrap:owner`.
  Forced password-change flow for directly-created members.
- **Roles & permissions**: full RBAC with org-wide and department-scoped role assignments,
  enforced server-side per command (never trust the client). See
  `docs/v2/AUTHORIZATION_IMPLEMENTATION.md` / `docs/v2/PERMISSIONS_MATRIX.md`.
- **Task step-pipeline**: multi-step ordered tasks (`task_step`/`task_step_event` subcollections),
  auto-advance on completion, send-back to any earlier step with a mandatory reason, per-step due
  dates, WhatsApp reminder links (`wa.me` deep links, client-side generated, no server-side send
  capability), Google Drive links attached to tasks. Checklist and subtask sub-entities with real
  add/check/status UI. Archive actions for tasks/projects/departments/teams where the backend
  command already existed.
  **Not yet built** (requested in a prior turn this session but not implemented before this
  documentation task started — verified by grepping the codebase for "reassign" and the Arabic
  strings "تحويل لشخص آخر" / "معلّقة"/"مستنية", all absent): reassigning a step's current holder to
  someone else, and a "pending/waiting with reason" step status distinct from the existing
  `pending` (not-yet-started) status. Both are still open work — see §3.
- **Departments/employees/org structure**: directory management, member creation with one-time
  temp password (shown/copyable at creation), department/team CRUD including archive.
- **Dashboards**: role-scoped (Employee sees their own tasks; Manager/Owner see org-wide;
  Department Lead sees their department), with inline quick-actions.
- **Notifications**: in-app bell (real titles/previews resolved from i18n keys, not raw keys) +
  browser push. A dismissible permission banner requests Notification permission post-login; a
  service worker (`apps/web/public/sw.js`) shows OS notifications and focuses/opens the app to the
  right task on click. Push only works while a tab is open (foreground or background) — see §3 for
  the closed-browser gap.
  Event coverage includes: step arrival, step sent-back, comments/mentions, escalation, and daily
  digest (see below), audience-resolved beyond just the directly-involved assignee (department
  leads, org owners/managers included where relevant).
- **Escalation logic**: `StalledTaskEscalationService` reuses the existing `isTaskStalled()`
  3-day-threshold check; on a fresh stall it notifies (in-app + push) both the department lead of
  the stalled step and every org-wide Owner/Manager, exactly once per task/step (Firestore
  transaction-marker dedup). Unit-tested with a `MemoryStore` harness (`tests/stalled-task-escalation.test.ts`).
- **Daily digest logic**: `DailyDigestService` sends each active user a once-daily,
  role-scoped summary (due-today / stalled-overdue counts) at their local 08:00, in-app + push
  only (no WhatsApp, intentionally, to keep that channel for higher-urgency escalation). Unit-tested
  (`tests/daily-digest.test.ts`).
- **File uploads**: local storage provider works end-to-end in the emulator; R2/malware-scanner
  fail closed by design when unconfigured (see §3 — not a bug).

## 3. What's Not Done Yet / Known Gaps

**Deployment & infrastructure**
- **No real Firebase project exists.** Everything runs against the local emulator suite only
  (`firebase emulators:start`). `.firebaserc` / project config for a real environment has not been
  created.
- **No hosting/deployment has ever happened.** The app has never been reachable outside
  `localhost`. Deploying Functions, Hosting, and Firestore rules/indexes to a real project is
  fully outstanding work.
- **The two scheduled endpoints exist and are tested, but nothing calls them automatically.**
  `POST /internal/scheduled/escalate-stalled-tasks` and `POST /internal/scheduled/send-daily-digests`
  (in `services/workers/src/http.ts`) work correctly when invoked, but no Cloud Scheduler (or
  equivalent cron) job is wired up to call them — same gap as the pre-existing
  `/internal/scheduled/reconcile-outbox` and `/internal/scheduled/notification-delivery` endpoints.
  This needs provisioning in the real project.
- **Closed-browser push notifications don't work.** The current implementation
  (`apps/web/src/lib/pushNotifications.ts` + `apps/web/public/sw.js`) delivers real OS
  notifications only while at least one browser tab is open (foreground or background). True
  push-to-a-fully-closed-browser requires Web Push/FCM infrastructure (VAPID keys, a push
  subscription store, `firebase-messaging-sw.js` or equivalent) that does not exist in this repo
  yet.

**Feature gaps carried over from this session's own audit** (see `docs/v2/FULL_AUDIT_FINDINGS.md`
for full detail — dated 2026-07-31, still accurate except where this handover's §2 notes newer
fixes on top of it):
- Automations page has no create form and no `/v1/automations/create` backend endpoint —
  automation authoring is genuinely unimplemented end-to-end (audit item E4, still true — verified
  by grep, no matches).
- Several "derived display field" placeholders remain (M2b): task-row assignee names and
  subtask/checklist counts on list views, client active-project counts — these are heavier
  per-row joins that were deferred, not defects.
- Step reassignment and the pending/waiting-with-reason step status (requested this session) are
  not implemented — see §2.

**Deliberately unconfigured (by design, not a bug)**
- No real AI provider is configured.
- No real malware scanner is configured (`MALWARE_SCANNER_PROVIDER=local` in `.env.example`).
- Both fail **closed** when unconfigured — i.e., they refuse rather than silently pass unsafe
  content through. Documented as BLK-002 in the audit findings.
- No real email provider (`EMAIL_PROVIDER=local`) or object storage (`FILE_STORAGE_PROVIDER=local`,
  R2 credentials are placeholders) is configured either — same fail-closed pattern.

**Known disclosed limitations**
- Daily digest's "due today" count compares UTC calendar date, not each recipient's own timezone
  (a disclosed approximation — task due dates carry no inherent timezone of their own).
- Headless Chromium under Playwright always reports `Notification.permission` as `'denied'`
  (never `'default'`), a known automation-safety quirk — it means the permission banner's actual
  grant flow can only be confirmed by a human in a real browser, not by automated Playwright runs.

## 4. How to Run Locally

Verified against the current `package.json` scripts and `docs/v2/LOCAL_DEVELOPMENT.md` — these
are accurate as of today.

```bash
# 1. Install dependencies (workspace root)
npm install

# 2. Build once so bootstrap's compiled output exists
npm run build

# 3. Start the emulators (Auth + Firestore + Functions), with data that persists across restarts
npm run emulators:dev
# = firebase emulators:start --project zamam-emulator --only auth,firestore,functions
#   --import=./.local-run/emulator-data --export-on-exit=./.local-run/emulator-data
# IMPORTANT: stop it with a clean Ctrl+C / SIGTERM, not a force-kill, or you lose data since the
# last clean exit (--export-on-exit only runs on clean shutdown).

# 4. One-time only, per fresh .local-run/emulator-data: bootstrap the first Owner + org
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export GCLOUD_PROJECT=zamam-emulator
npm run bootstrap:owner -- \
  --organization-id=org-demo --organization-name="ZAMAM Demo" --organization-slug=zamam-demo \
  --owner-email=owner@zamam.local --owner-name="Zamam Owner" --owner-password=Owner-Password-12345
# Safe to re-run — idempotent, check-then-create.

# 5. Start the web app (separate terminal)
npm run dev   # = npm run dev --workspace @zamam/web, defaults to http://localhost:5173

# 6. (Optional) Run the workers HTTP service locally, e.g. to manually hit the scheduled endpoints
npm run build --workspace=@zamam/workers
npm run start --workspace=@zamam/workers   # listens on WORKER_HTTP_PORT / PORT, default 8081
```

Then log in at `http://localhost:5173/login` with `owner@zamam.local` / `Owner-Password-12345`.

**Never** run `npm run test:rules` directly against a running `emulators:dev` instance — it calls
`clearFirestore()` and will wipe your local data. Use `npm run test:emulator` instead (spins up
its own throwaway emulator via `firebase emulators:exec`); it now fails fast with an explicit
error if run any other way. Full detail: `docs/v2/LOCAL_DEVELOPMENT.md`.

**Full check pipeline** (typecheck + lint + unit tests + build + bundle check):
```bash
npm run check
```

## 5. What Production Setup Requires

Checklist for the incoming developer, roughly in order:

1. **Create a real Firebase project** (Blaze plan — Functions 2nd gen + outbound network needs
   it). Enable Authentication (email/password), Firestore (native mode), Cloud Functions, Cloud
   Run (workers), and Hosting.
2. **Configure Firestore**: deploy `firestore.rules` and indexes (check for a `firestore.indexes.json`
   or equivalent at repo root / `services/firestore`) to the real project. Confirm the security
   rules tests (`npm run test:emulator`) pass against the rules as deployed.
3. **Set environment variables / secrets** — do not copy the `.env.example` placeholder values as-is:
   - `apps/web/.env` (from `apps/web/.env.example`): real `VITE_FIREBASE_*` values from the new
     Firebase project's config, `VITE_API_BASE_URL` pointed at the deployed Functions URL,
     `VITE_USE_FIREBASE_EMULATORS=false`, a real `VITE_FIREBASE_APPCHECK_SITE_KEY` if App Check is
     enabled.
   - `services/functions/.env` (from `services/functions/.env.example`): `ZAMAM_ALLOWED_ORIGINS`
     set to the real deployed web origin (not localhost), real `CLIENT_PII_ENCRYPTION_KEY` /
     `CLIENT_PII_HASH_KEY` (32-byte keys, generated fresh — never reuse the local placeholder),
     a real `FILE_STORAGE_PROVIDER` (R2 or equivalent) with real `R2_*` credentials if file uploads
     are needed at launch, a real `MALWARE_SCANNER_PROVIDER`/endpoint/credential if uploads should
     be scanned (they fail closed without one — decide if that's acceptable at launch or blocking),
     a real `EMAIL_PROVIDER`/`RESEND_API_KEY` if email notifications are needed, `ZAMAM_APP_BASE_URL`
     set to the real web origin.
     **Note**: `npm run package:functions` does not copy `.env` into the deploy artifact — secrets
     must be set via Firebase Functions config / Secret Manager for a real deployment, not a local
     `.env` file.
   - Workers service: `WORKER_INTERNAL_SHARED_SECRET` (used by `checkAuth()` in
     `services/workers/src/http.ts` to authenticate calls to `/internal/*` endpoints — currently
     `null`/unset locally, meaning auth is a no-op; **must** be set to a real secret before any
     internet-reachable deployment), `WORKER_HTTP_PORT`/`PORT`, `ZAMAM_ENV=production`,
     `ZAMAM_APP_BASE_URL`.
4. **Set up Cloud Scheduler** (or equivalent) for the four `/internal/scheduled/*` endpoints in
   `services/workers/src/http.ts`: `reconcile-outbox`, `notification-delivery`,
   `escalate-stalled-tasks`, `send-daily-digests` — none are currently invoked by anything.
   Each scheduled call must include the `x-worker-token` header (or `?token=`) matching
   `WORKER_INTERNAL_SHARED_SECRET`, and `escalate-stalled-tasks`/`send-daily-digests` need a JSON
   body `{"organizationId": "..."}` per organization to process.
5. **Decide on Web Push/FCM** if closed-browser push notifications are a launch requirement — the
   current implementation only reaches open tabs. This needs VAPID key generation, a push
   subscription store (new Firestore collection), and a `firebase-messaging-sw.js` service worker
   in place of (or alongside) the current minimal one.
6. **Deploy Cloud Functions and Hosting**: `npm run package:functions` builds the deploy artifact;
   confirm the actual `firebase deploy` step (not present as an npm script — check
   `docs/v2/BACKEND_OPERATIONS_RUNBOOK.md` / `docs/v2/PRODUCTION_LAUNCH_AND_ROLLBACK_RUNBOOK.md`
   for the intended process) and wire it into CI or run it manually for first launch.
7. **Deploy the workers service** to Cloud Run (or equivalent) — it's a plain Node HTTP server
   (`services/workers/src/server.ts`), not a Cloud Function; needs its own container/service.
8. **Review `docs/v2/SECURITY_LAUNCH_REVIEW.md` and `docs/v2/PRODUCTION_LAUNCH_AND_ROLLBACK_RUNBOOK.md`**
   before flipping real users onto it — these are launch-readiness documents already written for
   this purpose.
9. Run `npm run check:launch-readiness` and `npm run check` clean before go-live.

## 6. Architecture Map

- **`apps/web`** — React frontend (Vite). All untrusted-input UI. Talks to the backend only
  through `VITE_API_BASE_URL` (`/v1/*` commands/queries), never touches Firestore directly except
  reading its own `sessionViews/{userId}` doc for auth gating (`apps/web/src/auth/session-reader.ts`).
- **`services/functions`** — the trusted backend API (Cloud Functions 2nd gen in production, local
  Functions emulator in dev). `src/api/` holds the transport-agnostic Request/Response core
  (`api.ts`, `registry.ts`, `feature-routes.ts`, `handlers/*`); `firebase-adapter.ts` adapts it to
  Cloud Functions. Each domain area (`task/`, `employee/`, `organization/`, `project/`, ...) has a
  `service.ts` with the actual command/query logic, wrapped by `AuditCommandService` for outbox +
  idempotency semantics.
- **`services/workers`** — background/scheduled job processing (Cloud Run in production). Handles
  outbox event dispatch (`dispatch.ts`), notification projection (`notification-projection.ts`),
  escalation (`stalled-task-escalation.ts`), and daily digest (`daily-digest.ts`). Exposes a plain
  Web-standard handler (`http.ts`) adapted to Node's `http` by `server.ts` — no Cloud
  Functions-specific code in the handler itself.
- **`packages/domain`** — pure business logic and types shared by both `functions` and `workers`
  (e.g. `task.ts`'s `isTaskStalled()`, status-transition assertions, `notifications.ts`'s event
  policy table). No I/O.
- **`packages/authorization`** — role/permission model, default roles (`default-roles.ts`),
  capability evaluation.
- **`packages/firestore`** — Firestore adapter (`AtomicTransaction`, `FirebaseAtomicStore`) and the
  in-memory `MemoryStore` test double used throughout the test suite.
- **`packages/contracts`**, **`packages/config`**, **`packages/observability`** — shared
  request/response schemas, environment config loading, and logging respectively.
- **`docs/v2/`** — all design/architecture documentation. Start with `PRODUCT_BLUEPRINT.md` (product
  framing, Arabic), `DATA_MODEL_V2.md`/`DOMAIN_MODEL.md` (schema), `API_AND_BACKEND_ARCHITECTURE.md`,
  `AUTHORIZATION_IMPLEMENTATION.md`, `TASK_LIFECYCLE_AND_VALIDATION.md`, `LOCAL_DEVELOPMENT.md`
  (this file's source for §4), `FULL_AUDIT_FINDINGS.md` (source for most of §3), and
  `docs/v2/adr/` (numbered Architecture Decision Records — read these first for the "why" behind
  the repo's shape).

## 7. Key Decisions Log

Full reasoning lives in the referenced docs — this is just enough to know where to look.

- **Why `sessionViews/{userId}` exists**: the web app's `ProtectedRoute` needs to know, on every
  page load, whether the logged-in user has at least one active organization membership — without
  requiring a tenant-scoped Firestore read (which would need to know the org ID first). It's a
  top-level, non-tenant read model the client reads directly (Firestore rules allow only a self
  `get`, no writes), aggregated server-side from `organization_membership` writes so it's never
  computed client-side from data the client shouldn't be trusted to interpret. See
  `services/functions/src/platform/session-view.ts` and `docs/v2/AUTH_LIFECYCLE_AND_THREAT_MODEL.md`.
- **Why the command dispatcher is registry-based**: `services/functions/src/api/registry.ts`
  defines `HandlerRegistry` as a `Partial<Record<FeatureApiPath, CommandHandler>>` — a typed map
  from route path to handler, rather than an if/else chain or per-route file wiring. This keeps
  `FEATURE_API_PATHS` (`feature-routes.ts`) as the single source of truth for "what routes exist,"
  makes it mechanically impossible to register a handler for a path the type system doesn't know
  about, and keeps auth/idempotency/fingerprinting cross-cutting concerns in one place
  (`CommandContext`) instead of duplicated per handler. See `docs/v2/API_AND_BACKEND_ARCHITECTURE.md`
  and ADR `docs/v2/adr/0002-trusted-backend-transport.md`.
- **Why steps are a subcollection (`task_step`/`task_step_event`), not an embedded array on the
  task document**: this follows the pattern the codebase already established for
  `subtask`/`checklist_item` (also subcollections, not arrays) rather than inventing a new shape.
  Practical reasons: each step needs its own optimistic-concurrency `version` for safe concurrent
  updates, `task_step_event` gives each transition (advance, send-back) its own append-only audit
  row without growing an unbounded array on the parent doc, and per-step Firestore queries (e.g.
  "all steps currently assigned to department X") are only possible if steps are queryable
  documents. See the commit message on `47a9bda` ("redesign tasks around an ordered step
  pipeline") and `docs/v2/TASK_LIFECYCLE_AND_VALIDATION.md`.
- **Why the heavyweight `WorkflowExecutionService` (template/version-based) wasn't reused for
  task steps**: it was evaluated and rejected as the wrong shape — it's built for reusable,
  org-wide published pipelines, whereas task steps are ad-hoc, defined per-task by its creator on
  the spot, with free-form send-back to any earlier step. Two different features that happen to
  sound similar; kept separate rather than forcing one into the other's model. See the same
  `47a9bda` commit message.
- **Why escalation/digest write directly via `store.runTransaction` instead of going through
  `AuditCommandService`**: `AuditCommandService` is built for user-actor commands with idempotency
  keys tied to a request; escalation and digest are system-initiated background scans with no
  "acting user" and their own fire-once-per-event semantics (a dedicated marker-document
  transaction, not a version bump on the target entity — chosen specifically to avoid racing a
  user's own concurrent optimistic-concurrency-checked edit to that same task).
