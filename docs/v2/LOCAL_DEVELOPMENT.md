# Local Development

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
