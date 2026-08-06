# Local Development

## Starting the emulators (with persistent data)

**Use `npm run emulators:dev` to start the local Auth/Firestore/Functions emulators for manual testing —
not a bare `firebase emulators:start`.** The Firestore and Auth emulators only ever hold data in memory;
a plain `emulators:start` loses everything the moment the process exits, which meant every restart (or
crash, or an unrelated `test:rules` run — see "Emulator data loss incident" below) silently wiped
`org-demo` and forced a re-bootstrap.

```
npm run emulators:dev
```

This is `firebase emulators:start --project zamam-emulator --only auth,firestore,functions
--import=./.local-run/emulator-data --export-on-exit=./.local-run/emulator-data` (with the target
directory created first if it doesn't exist yet — `--import` errors on a missing path). `.local-run/` is
already gitignored, so this data never gets committed.

**For this to actually persist, shut the emulator down normally — Ctrl+C in the terminal it's running in
(or, if it was started detached, a normal SIGTERM/`Stop-Process` without `-Force` if possible).**
`--export-on-exit` only runs on a clean shutdown; a forceful kill (`-Force`/`SIGKILL`, killing the wrong
process tree, or the machine losing power) skips the export and you lose whatever changed since the last
clean exit — same failure mode as before, just narrower. If you need to kill it forcefully for some
reason, run `firebase emulators:export ./.local-run/emulator-data --project zamam-emulator` first while
it's still up.

Data now survives normal restarts and machine reboots. You only need `npm run bootstrap:owner` (see
below) once per fresh `.local-run/emulator-data` directory — after that, `owner@zamam.local` keeps
working across sessions as long as you always start with `emulators:dev` and stop it cleanly.

### Emulator data loss incident (why the guard below exists)

Earlier, `owner@zamam.local` intermittently stopped being able to log in
(`"الحساب غير نشط أو لا يملك عضوية مؤسسة فعالة"`) with no code change to explain it. The cause was never a
new authorization bug — the `sessionViews` projection and Firestore rules were untouched and correct. The
actual cause was `tests/firestore-rules.emulator.test.ts`, whose `beforeEach` calls
`environment.clearFirestore()` on every single test. When that suite is run correctly — wrapped in
`firebase emulators:exec`, which starts an emulator solely for that test run and tears it down after —
this is fine, since it's a dedicated throwaway instance. But `@firebase/rules-unit-testing`'s
`initializeTestEnvironment()` doesn't care which emulator it's talking to; it just connects to whatever is
listening on the Firestore emulator port from `firebase.json` (8080). Running `npm run test:rules` (or
`vitest run --config vitest.emulator.config.ts`) **directly**, while a developer's own long-running
`emulators:dev` instance happened to already be up on that same port, connected the test suite straight to
it — and `clearFirestore()` wiped `org-demo` along with everything else. See "Never run the rules tests
directly" below for the structural fix.

## Bootstrapping the first Owner and organization

There is no self-service "create organization" flow in the product (by design — see
`CODEX_AUTONOMOUS_MASTER_GOAL.md` §4.2: the first Owner must never be inferred from a legacy role and
must come from a secure, out-of-band bootstrap step). `tools/bootstrap-owner.mjs` is that step.

It creates — idempotently, check-then-create per record, safe to re-run — an organization, a root
department (needed to satisfy `employment_profile.primaryDepartmentId`), a Firebase Auth user for the
owner (or reuses one that already exists for that email), an active `organization_membership` and
`employment_profile`, the canonical `Owner` role (taken as-is from
`packages/authorization/src/default-roles.ts` — every non-`platform.*` permission; no permissions are
invented here), and a `role_assignment` granting Owner at organization scope.

The underlying logic lives in `services/functions/src/organization/bootstrap-service.ts`
(`BootstrapOwnerService`), unit-tested in `tests/bootstrap-owner.test.ts`. The script is a thin CLI
wrapper around it.

### Safety

- Refuses to run unless both `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` are set (the
  standard Firebase Admin SDK emulator-redirect variables), i.e. it only targets a local/emulator
  Firestore by default.
- To point it at a real project, you must explicitly pass `--confirm-non-emulator=true`
  (or set `ZAMAM_BOOTSTRAP_CONFIRM_NON_EMULATOR=true`) — there is no accidental production write path.
- No credential is ever hard-coded; everything comes from CLI flags or environment variables you provide.

### Prerequisite

Build the workspace once so the compiled `services/functions/dist` output exists (the CLI is a plain
Node script, not a TypeScript runner):

```
npm run build
```

### Running it against the local emulator

```
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export GCLOUD_PROJECT=zamam-emulator

npm run bootstrap:owner -- \
  --organization-id=org-demo \
  --organization-name="ZAMAM Demo" \
  --organization-slug=zamam-demo \
  --owner-email=owner@zamam.local \
  --owner-name="Zamam Owner" \
  --owner-password=Owner-Password-12345
```

(All flags also accept the equivalent `ZAMAM_BOOTSTRAP_*` environment variable —
`ZAMAM_BOOTSTRAP_ORGANIZATION_ID`, `ZAMAM_BOOTSTRAP_ORGANIZATION_NAME`, `ZAMAM_BOOTSTRAP_ORGANIZATION_SLUG`,
`ZAMAM_BOOTSTRAP_OWNER_EMAIL`, `ZAMAM_BOOTSTRAP_OWNER_NAME`, `ZAMAM_BOOTSTRAP_OWNER_FIRST_NAME`,
`ZAMAM_BOOTSTRAP_OWNER_PASSWORD`, `ZAMAM_BOOTSTRAP_TIMEZONE`, `ZAMAM_BOOTSTRAP_LOCALE` — useful for
scripting without shell history exposing a password.)

On success it prints a JSON summary including `userId`, `roleAssignmentId`, and which actions this
specific run actually performed (`actionsPerformedThisRun: []` on a second run means it was already
fully bootstrapped — nothing was duplicated).

## Never run the rules tests directly against a running emulator

`tests/firestore-rules.emulator.test.ts` calls `environment.clearFirestore()` before every test — safe
only when it's run inside an emulator that `firebase emulators:exec` started just for that test run.

```
npm run test:emulator   # correct — emulators:exec spins up its own throwaway instance and tears it down after
npm run test:rules      # WRONG if a dev emulator (npm run emulators:dev) is already running — connects
                         # straight to it and clearFirestore() will wipe it
```

This isn't just a documentation warning: `tests/firestore-rules.emulator.test.ts`'s `beforeAll` refuses to
run unless `process.env.FIREBASE_EMULATOR_HUB` is set — an env var `firebase emulators:exec` (and only
`emulators:exec`) injects into the wrapped process. Running the suite any other way now fails fast with an
explicit "REFUSING TO RUN" error instead of silently clearing whatever Firestore emulator happens to be on
the default port. `firebase emulators:exec` itself is also already fail-closed here for a different reason:
if the ports it needs (8080/9099/5001) are already bound by a running `emulators:dev`, it refuses to start
at all rather than reusing that instance — so `npm run test:emulator` simply won't run while you have a
dev emulator up; stop `emulators:dev` first (data is safe either way, since it exports on clean exit) or
run the emulator tests from a machine/terminal where you don't have one running.

`tests/bootstrap-owner.emulator.test.ts` is not gated the same way — it only creates records (no
`clearFirestore()`), so running it against a live dev emulator is harmless, just possibly not idempotent
if that emulator already has leftover data from a prior test run.

## CORS and the web app talking to the Functions emulator

`services/functions/src/api/api.ts`'s CORS allowlist comes from `ZAMAM_ALLOWED_ORIGINS` (see
`services/functions/.env.example`). If you never created a `services/functions/.env` — and note that
`npm run package:functions` doesn't copy `.env` files into `.artifacts/functions`, so placing one there
gets silently wiped on every repackage — `resolveAllowedOrigins()` (`services/functions/src/api/api.ts`)
falls back to `http://localhost:5173` and `http://127.0.0.1:5173` automatically, but **only** when
`FUNCTIONS_EMULATOR=true` (i.e. only inside the local emulator; this can never affect a deployed Cloud
Function). If the web app's origin/port ever differs from those two, requests to `/v1/*` will fail with a
CORS preflight error in the browser console — set `ZAMAM_ALLOWED_ORIGINS` explicitly in that case.

## Running the workers service locally

`createWorkerHttpHandler()` (`services/workers/src/http.ts`) is a Web-standard `Request -> Response`
handler with no server wired to it. `services/workers/src/server.ts` is that wiring: a thin Node
`http` server that adapts Node's request/response streams to that handler — no dispatch or business
logic lives in it.

```
npm run build --workspace=@zamam/workers
npm run start --workspace=@zamam/workers
```

(`npm run dev --workspace=@zamam/workers` builds and starts in one step.) It listens on
`WORKER_HTTP_PORT` (falls back to `PORT`, then `8081`), and logs a single startup line with the port
and mode (`local` unless `ZAMAM_ENV=production`) — no secrets. `GET /health` is a good smoke check.
