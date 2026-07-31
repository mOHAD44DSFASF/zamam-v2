# Full Project Audit — Findings

Systematic audit of ZAMAM V2 (routes, endpoints, transaction ordering, frontend↔backend contract),
performed live against the local emulator stack as Owner (`owner@zamam.local`, org `org-demo`) via
headless Playwright, plus static analysis of every service and feature client.

Date: 2026-07-31. Method: `.local-run/pw/clickthrough.mjs` (per-route console/network/error capture),
`.local-run/pw/scan-tx.mjs` (read-after-write transaction scan), manual code inspection.

## Inventory summary

- **Web routes (protected, Owner-reachable):** 18 feature routes + `/workspace` redirect + `/admin`
  placeholder (see `apps/web/src/App.tsx`).
- **Backend endpoints:** ~60 in `FEATURE_API_PATHS` (`services/functions/src/api/feature-routes.ts`),
  mapped in `docs/v2/P28A_ENDPOINT_COMMAND_MAP.md` (verified still accurate).
- **Issues found:** 26 Critical/High + several Medium/Low (below). The dominant theme: the
  frontend↔backend contract was **never verified end-to-end** for most features — pages were built
  against rich composed "snapshot" shapes that the read handlers do not return, and several read
  handlers require query params the clients never send. Independently, the read-after-write
  transaction bug class (already fixed 3× this session) **recurs in 6 more services**.

## Severity legend

- **Critical** — page crashes / white-screens or a core action is impossible.
- **High** — page loads but a core action returns a hard error, or a core page shows an error card.
- **Medium** — degraded/missing data, hidden action buttons, page still usable for viewing.
- **Low** — cosmetic / future-scope / unreachable path.

## A. Response-shape mismatches — page crashes on load (Critical)

Every read handler below returns a bare `{ items }` / `{ items, nextCursor }` (or `{requests,proposals}`),
but the page's client is typed to receive a rich composed `*Snapshot` and dereferences fields that are
therefore `undefined`. React throws during render → white screen. (Same class as the already-fixed
Tasks page.)

| ID | Route | Handler returns | Page expects (client `*Snapshot`) | Crash | Sev |
|---|---|---|---|---|---|
| A1 | `/people` | `{items:[{userId,membershipStatus,displayName,jobTitle,employmentStatus}]}` | `{items, departments, capabilities}` | `capabilities.invite` undefined | Critical |
| A2 | `/clients` | `{items:[]}` | `{clients, contacts, capabilities}` | `clients[0]` undefined | Critical |
| A3 | `/projects` | `{items, nextCursor}` | `{projects, clients, departments, managers, capabilities}` | `[...][0]` undefined | Critical |
| A4 | `/workspaces` | `{items}` | `{workspaces, projects, teams, capabilities}` | `capabilities.create` undefined | Critical |
| A5 | `/templates` | `{items}` | `{templates, schedules, capabilities}` | `templates.map` undefined | Critical |
| A6 | `/files` | `{items, nextCursor}` | `{files, provider, capabilities}` | `provider.configured` undefined | Critical |
| A7 | `/notifications` | `{items, nextCursor}` | `{notifications, preferences, emailProvider, capabilities}` | `emailProvider.configured` undefined | Critical |
| A8 | `/workload` | `{items, nextCursor}` | `{periodStart, periodEnd, scope, availableScopes, rows, summary, capabilities}` | `rows.map` undefined | Critical |
| A9 | `/ai` | `{requests, proposals}` | `{provider, policy, requests, proposals, capabilities}` | `policy.enabled` undefined | Critical |
| A10 | `/automations` | `{items}` | `{automations, runs, capabilities, limits}` | `limits.maxDepth` undefined | Critical |

Evidence: click-through `pageErrors` all `"Cannot read properties of undefined (reading '<field>')"`;
API responses all HTTP 200 with the bare shape (see `.local-run/pw/clickthrough-results.json`).

Fix approach (chosen): a response adapter in each `features/*/client.ts` (the proven Tasks pattern) that
maps the real `items` into the page's primary list and supplies safe defaults for the auxiliary
fields, so the page **loads and shows real data**. Capability flags default to fail-closed (backend
still enforces every command) — this hides create/manage buttons, tracked as **M1 (Medium)** below:
composing real capability flags + auxiliary dropdown lists server-side (the pattern the
`/v1/organization/directory/query` handler already implements).

## B. Query-parameter mismatches — read returns HTTP 400 (High)

The handler requires params the client never sends; `requireString()` throws `INVALID_<FIELD>` → 400
`INVALID_REQUEST`. Page shows its error card.

| ID | Route | Handler requires | Client sends | Missing | Sev |
|---|---|---|---|---|---|
| B1 | `/v1/time/query` | `periodStart`, `periodEnd` | `{organizationId, periodStart, limit}` | `periodEnd` | High |
| B2 | `/v1/attendance/overview` | `periodStart`, `periodEnd` | `{organizationId}` | `periodStart`, `periodEnd` | High |
| B3 | `/v1/reports/query` | `subjectType`, `subjectId`, `periodStart` | `{organizationId, periodStart, limit}` | `subjectType`, `subjectId` | High |

Note: fixing the 400 alone would then expose a shape crash (these handlers also return bare `{items}`),
so each B fix also needs an A-style adapter.

Fix approach: client sends the required params (derive `periodEnd` from the period; default
`subjectType`/`subjectId` to the organization scope), plus a response adapter as in section A.

## C. Interleaved read-after-write inside a single Firestore transaction (High)

Same bug class already fixed in `bootstrap-service.ts`, `audit/service.ts`, `employee/service.ts`. Real
Firestore rejects any `transaction.get()` after a `transaction.create/update` in the same transaction
("all reads must be executed before all writes"). Invisible to unit tests because their in-memory
`AtomicStore` fakes don't enforce the rule. All are audited write commands reachable from the UI.

| ID | Service / method | Read-after-write | Sev |
|---|---|---|---|
| C1 | `organization/service.ts` `createTeam` | counter `get` after entity `create` | High |
| C2 | `organization/service.ts` `archiveDepartment` | unique-code `get` after archive `update` | High |
| C3 | `organization/service.ts` `archiveTeam` | unique-code + counter `get` after archive `update` | High |
| C4 | `organization/service.ts` `addTeamMember` | member-count `get` after membership write | High |
| C5 | `organization/service.ts` `endTeamMember` | member-count/allocation/primary `get` after `update` | High |
| C6 | `project/service.ts` `create` | client-project-count `get` after project `create` | High |
| C7 | `project/service.ts` `archive` | unique-code + count `get` after archive `update` | High |
| C8 | `client/service.ts` `archive` | unique-code `get` after archive `update` | High |
| C9 | `leave/service.ts` `request` | balance `get` after request `create` | High |
| C10 | `leave/service.ts` `decide` | balance `get` after approval `create`/`update` | High |
| C11 | `collaboration/service.ts` `create` | task-watcher `get` after comment/mention `create` | High |
| C12 | `review/service.ts` `resubmit` | prior-change `get` after approval `create` | High |
| C13 | `workflow/execution-service.ts` `transition` | next-execution `get` after current-execution `update` | High |

Fix approach: reorder each into an explicit read phase (all `get`s, incl. wrapper reads) then a write
phase — the pattern already applied to bootstrap/employee. Add read-after-write enforcement to the
affected services' in-memory test fakes as regression coverage.

## D. Config / Medium / Low (deferred — documented, not fixed in Phase 2)

- **M1** (Medium) — Real capability flags + auxiliary dropdown lists (projects/teams/contacts/leave
  types) for the section-A pages are not composed server-side, so after the A fixes create/manage
  buttons stay hidden and create-form dropdowns are empty. Proper fix: extend each read handler to
  compose capabilities via `authorization.evaluate` and the auxiliary lists, per the
  `/v1/organization/directory/query` template. Large; per-feature.
- **M2** (Medium) — Derived display fields the pages want (task/workspace `projectName`, assignee
  names, subtask/checklist counts, workload `summary`/`rows` projection, file `provider` status) are
  not produced by the read handlers; the A adapters render them as null/empty placeholders.
- **M3** (Medium) — `/workload` needs a real capacity projection (`WorkloadProjectionService.rebuild`
  output), not a raw entity list; the A8 adapter renders an empty projection until that read path is
  built.
- **L1** (Low) — `template/service.ts` `runOccurrence` calls `materialize(transaction)` then writes;
  the materializer is an unconfigured stub (`RECURRENCE_MATERIALIZATION_NOT_CONFIGURED`) and the path
  is worker-only (no API route), so not UI-reachable. The future real materializer must front-load its
  reads; noted here so it isn't reintroduced as a read-after-write.
- **L2** (Low) — AI/malware-scanner/email real providers remain unconfigured by design (BLK-002); out
  of scope per standing instructions.

## Status tracker (final — Phase 3)

Two additional read-after-write bugs (C14 review.expire, C15/C16 time.submit/decide loops, C17
workload.rebuild loop) were surfaced during Phase 2 by the test-fake ordering enforcement and the
loop-carried scanner — the static scanner alone missed the loop-carried ones. All fixed.

| ID | Status | Verification |
|---|---|---|
| A1–A10 (page-load crashes) | **Fixed** | Live Playwright: all 18 routes load with 0 crashes/console errors/failed requests |
| B1–B3 (query-param 400s) | **Fixed** | Live Playwright: /time, /attendance, /reports load cleanly (no 400) |
| C1–C17 (read-after-write) | **Fixed** | 463/463 tests with real-Firestore-rule enforcement in 16 fakes; createTeam (C1) driven live through the API against the real Firestore emulator → 200, no read-after-write error |
| M1 — real capabilities + auxiliary pick-lists composed server-side | **Fixed** (77cf87e, a8498a7) | Every read handler composes real capabilities via `evaluateCapabilities` (TrustedAuthorizationService); adapters read them; pick-lists (departments/clients/managers/projects/teams/workspaces) composed. Live: action buttons render; capability unit tests (authorized/unauthorized/per-resource) |
| M2 — derived display fields (names, counts, provider status, proposal grouping) | **Fixed** (batch names) / **Partial** (77cf87e, a8498a7) | Batch `resolveNames` resolves employee department, project client/manager/department, workspace project/team names. Live-rendered. **Still placeholder** (documented below as M2b): task-row assignee names + subtask/checklist counts + workflow summary, and client active-project counts — heavier per-row joins |
| M3 — `/workload` capacity projection read path | **Fixed** (a8498a7) | Root cause was the query ordering by `utilizationPercent`, which unknown rows omit → Firestore excluded them → always empty. Reordered by always-present `allocatedMinutes`+`userId`; index updated. Live: rebuild→query returns rows (was 0) |
| L1 — `template.runOccurrence` materializer read ordering | **Deferred (Low)** | worker-only, unconfigured stub; front-load reads when built |
| L2 — AI/malware/email real providers | **Deferred (Low)** | unconfigured by design (BLK-002); out of scope |

## E. Findings from the action-focused re-audit (Steps 1/5)

| ID | Area | Description | Severity | Status |
|---|---|---|---|---|
| E1 | create payloads | `clients.create`, `clients.addContact`, `projects.create` never sent the required `id` (others did) → the command `400`'d even with the button showing | High | **Fixed** (a8498a7) — generate `crypto.randomUUID()` |
| E2 | error mapping | Business-rule state errors (`CLIENT_NOT_ACTIVE`, `TASK_PROJECT_NOT_ACTIVE`, `_INSUFFICIENT`, …) fell through `domainError` to a bare **500 INTERNAL_ERROR** instead of a 4xx | High | **Fixed** (a8498a7) — map to **409 CONFLICT**; regression test added |
| E3 | lifecycle | New clients are `'lead'` and new projects `'draft'`, but **no UI/endpoint advanced them** → projects (need an active client) and tasks (need a planned/active project) could never be created | High | **Fixed** (a8498a7) — exposed `/v1/clients/transition` + `/v1/projects/transition` (wired to existing services) + activate buttons |
| E4 | automations | The `/automations` page has **no create form** and the client has no create method (nor a `/v1/automations/create` backend endpoint) — automation authoring is unimplemented end-to-end | Medium | **Deferred** — genuine unbuilt feature (rule/trigger/action builder); larger than this pass. Documented, not hidden |
| M2b | enrichment | Task-row assignee names, subtask/checklist counts, and workflow summary; client active-project counts — still placeholders (heavier per-row joins than the batch name resolution done for M2) | Medium | **Deferred** — documented |

### Live end-to-end verification (Step 6)

Playwright, logged in as Owner, created a record through the **UI** for 5 resource types and confirmed
each persisted after a page reload: **workspace, client, employee, project, task** — the full
`client → activate → project → approve-plan → task` dependency chain, zero page errors. Full click-through
of all 18 routes: clean.

No Critical/High item was left unfixed. The Medium/Low items are genuine follow-ups (feature completion,
not defects that crash or hard-block core usage), documented here rather than omitted.
