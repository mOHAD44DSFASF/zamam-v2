# ZAMAM V2 — AUTONOMOUS FULL-BUILD GOAL

You are operating inside the existing ZAMAM repository. Prompt 1 has already been completed, and the authoritative product and architecture blueprint is stored under `docs/v2/`.

Your mission is to implement the entire ZAMAM V2 roadmap from Prompt 2 through Prompt 28 as one continuous, autonomous engineering goal.

Do not stop after planning. Begin implementation immediately and continue until every milestone and quality gate is complete, or until a genuine hard blocker outside the repository makes further progress technically impossible.

---

## 1. Authoritative sources

Before changing anything, read all of these files completely:

- `PROJECT_OVERVIEW_AND_AUDIT.md`
- `docs/v2/PRODUCT_BLUEPRINT.md`
- `docs/v2/DOMAIN_MODEL.md`
- `docs/v2/PERMISSIONS_MATRIX.md`
- `docs/v2/WORKFLOW_SPECIFICATION.md`
- `docs/v2/DATA_MODEL_V2.md`
- `docs/v2/API_AND_BACKEND_ARCHITECTURE.md`
- `docs/v2/UI_INFORMATION_ARCHITECTURE.md`
- `docs/v2/MIGRATION_STRATEGY.md`
- `docs/v2/IMPLEMENTATION_ROADMAP.md`
- `docs/v2/OWNER_DECISIONS.md`
- `docs/v2/BLUEPRINT_VALIDATION_REPORT.md`

Treat these files as the primary specification. The existing source code is evidence of V1 behavior, not an architectural constraint on V2.

When documents conflict, use this precedence:

1. Security and tenant isolation.
2. Approved decisions in this goal.
3. `BLUEPRINT_VALIDATION_REPORT.md`.
4. `PERMISSIONS_MATRIX.md`, `DOMAIN_MODEL.md`, and `DATA_MODEL_V2.md`.
5. `API_AND_BACKEND_ARCHITECTURE.md`.
6. `WORKFLOW_SPECIFICATION.md`.
7. `PRODUCT_BLUEPRINT.md` and `UI_INFORMATION_ARCHITECTURE.md`.
8. Existing V1 behavior.

Document every material conflict and the resolution in `docs/v2/AUTONOMOUS_DECISION_LOG.md`.

---

## 2. Standing authorization

The repository owner grants standing approval for all non-destructive, in-scope local development actions required to complete Prompts 2–28.

Do not ask for routine confirmation before:

- Reading or searching any repository file.
- Creating, editing, moving, renaming, or deleting repository files when required by the approved architecture.
- Refactoring or replacing legacy code.
- Restructuring the repository.
- Creating applications, packages, backend services, tests, scripts, migrations, emulators, fixtures, and documentation.
- Installing, removing, or upgrading dependencies.
- Updating package manifests and lockfiles.
- Running formatters, linters, type checks, tests, builds, local servers, emulators, local containers, vulnerability scans, and bundle analysis.
- Creating local development data and test accounts inside emulators.
- Running local or emulator-only migration dry runs.
- Using a browser locally to test the application.
- Looking up official technical documentation and package documentation.
- Creating local Git branches, commits, tags, and checkpoints.
- Choosing safe technical implementation details that are not explicitly fixed in the blueprint.
- Fixing failures discovered during testing.
- Repeating failed safe commands after diagnosing them.
- Using isolated worktrees or subagents for independent tasks when supported.
- Updating all V2 documentation to match the implementation.

Do not pause to ask what to do when a safe recommended default exists. Choose the safest, least-privileged, reversible option and continue.

---

## 3. Actions not authorized

Even under autonomous execution, do not perform these actions:

- Do not deploy to production.
- Do not modify, delete, migrate, or read real production Firebase data.
- Do not write to real production object storage.
- Do not send real emails, WhatsApp messages, SMS messages, push notifications, or external webhooks.
- Do not create paid cloud resources or make purchases.
- Do not rotate, reveal, print, copy, or commit secrets.
- Do not connect unknown third-party accounts.
- Do not push to a remote Git repository unless a remote is already configured and an explicit repository policy inside the project authorizes automatic pushing.
- Do not force-push.
- Do not merge into a protected production branch.
- Do not remove backups or the original V1 snapshot.
- Do not weaken security controls to make tests pass.
- Do not use production credentials in tests.
- Do not bypass a quality gate by marking it complete without evidence.

When an external credential or production service is unavailable, implement the complete adapter, configuration contract, local mock or emulator, tests, UI states, and documentation. Mark the integration as `NOT_CONFIGURED` or feature-flagged, then continue with the remaining roadmap.

Missing credentials are not a reason to stop implementation.

---

## 4. Approved owner decisions

All `Recommended default` values in `docs/v2/OWNER_DECISIONS.md` are approved and must be treated as final for this autonomous build, with the explicit resolutions below.

### Explicit resolutions for decisions that otherwise require review

1. **Tenant model**
   - Build one Organization per tenant with optional branches.
   - Global identity may have memberships in multiple organizations.
   - All tenant-owned records require `organizationId`.
   - Cross-organization access is always denied.

2. **Legacy administrative roles**
   - Never infer an Owner from the legacy `Admin` role.
   - In migration previews, legacy `Admin` maps to `GeneralManager`.
   - The first Owner must be created through a secure bootstrap command that reads identity from environment configuration.
   - No Owner email or password may be hardcoded.
   - An unresolved legacy `Manager` or custom role receives no privileged V2 permission until a scope is deterministically resolved.
   - Ambiguous records must be quarantined in a migration report rather than granted broad access.

3. **Backend**
   - Use the blueprint recommendation: Hybrid Firebase Cloud Functions 2nd gen plus Cloud Run services/jobs.
   - Keep shared typed contracts and authorization logic independent of transport.
   - Privileged business writes are backend-only.

4. **Operational database**
   - Continue using Firestore as the V2 operational database.
   - Use canonical typed converters, backend-generated UTC timestamps, transactions, idempotency, append-only audit events, and transactional outbox patterns.
   - Keep repository abstractions capable of future relational or warehouse projections.

5. **Object storage**
   - Use Cloudflare R2 as the primary production-oriented object-storage adapter because V1 already references R2.
   - Keep `FileService` provider-agnostic.
   - Use a local fake or emulator-compatible object store for development and tests.
   - All objects are private by default, accessed through short-lived signed operations.
   - No permanent public upload URLs.

6. **Email and external notifications**
   - Implement in-app notifications completely.
   - Implement a provider-agnostic email adapter.
   - Use a local capture/mock provider when real credentials are absent.
   - Do not send real messages during this run.

7. **Search**
   - Implement a `SearchService` abstraction and a functional bounded search experience using the most suitable repository-local or Firestore-compatible approach.
   - Keep an external search-provider adapter extension point.
   - Do not provision a paid search service.

8. **AI**
   - Implement an OpenAI-compatible AI gateway behind configuration and feature flags.
   - Use mock responses in automated tests.
   - AI is proposal-only in the first release.
   - AI cannot directly change permissions, approve work, delete records, publish workflows, or perform other high-risk actions.
   - If no API credential exists, the full UI and backend contract must remain usable in disabled/demo mode.

9. **Automation**
   - Automations execute through a limited service principal.
   - Only allowlisted low-risk actions may execute automatically.
   - High-risk actions become human approval proposals.

10. **Privacy and regional rules**
    - Implement configurable privacy, retention, consent, and data-residency policy interfaces.
    - Use conservative privacy defaults.
    - Do not claim legal compliance with a specific country without legal review.
    - Missing legal review is a production-launch blocker, not an implementation blocker.

11. **Retention and recovery**
    - Sensitive audit events: seven-year configurable retention.
    - Archived tasks and projects: five-year configurable retention.
    - Deleted files: 30-day recoverable retention unless legal hold applies.
    - Default recovery objectives: RPO 24 hours and RTO 8 hours.
    - Implement backup, export, restore, and recovery runbooks and local/staging rehearsal tooling without touching production.

12. **Billing**
    - Billing, subscription charging, payroll, and accounting are outside this build.
    - Provide only clean entitlement and future-module extension points where specified.

13. **Attendance**
    - Implement attendance in the Management Release using approved manual entry and correction first.
    - Do not implement GPS, biometric, or device tracking without a future explicit decision.

14. **SLA**
    - Support configurable workflow SLAs.
    - Initial KPI target values remain unset until a four-week baseline exists.
    - This does not block implementation.

These choices must be written to `docs/v2/AUTONOMOUS_APPROVED_DECISIONS.md` with their source decision IDs and implementation consequences.

---

## 5. Execution mode

Operate in long-horizon goal mode.

If multi-agent or isolated-worktree execution is available, use it only for independent work, such as:

- Documentation and contracts.
- Backend and frontend implementations with stable interfaces.
- Independent test suites.
- Accessibility review.
- Security review.
- Performance review.

Do not parallelize milestones that depend on uncommitted schema, authorization, or migration decisions. Integrate parallel work only after reviewing diffs and running the complete relevant test suite.

Do not merely generate 27 additional prompts. Implement the roadmap itself.

---

## 6. Baseline and recovery preparation

Before Prompt 2:

1. Inspect repository and Git state.
2. If Git exists:
   - Record current branch and status.
   - Create a new local branch named similar to `codex/zamam-v2-autonomous`.
   - Preserve all pre-existing user changes.
3. If Git does not exist:
   - Initialize a local Git repository.
   - Respect `.gitignore`.
   - Create a baseline commit of the original project and Prompt 1 documentation.
4. Create a local backup archive outside generated build folders.
5. Record baseline:
   - Node/npm versions.
   - Install result.
   - Type-check result.
   - Lint result.
   - Test availability.
   - Production build result.
   - Dependency audit summary.
   - Current screenshots of primary routes when practical.
6. Never overwrite the only copy of the V1 project.

Create:

- `docs/v2/AUTONOMOUS_EXECUTION_PLAN.md`
- `docs/v2/AUTONOMOUS_PROGRESS.md`
- `docs/v2/AUTONOMOUS_APPROVED_DECISIONS.md`
- `docs/v2/AUTONOMOUS_DECISION_LOG.md`
- `docs/v2/AUTONOMOUS_BLOCKERS.md`
- `docs/v2/AUTONOMOUS_TEST_MATRIX.md`
- `docs/v2/AUTONOMOUS_FINAL_REPORT.md`

`AUTONOMOUS_PROGRESS.md` is the durable continuation ledger. Update it after every meaningful unit of work so another agent can resume without rereading the full history.

---

## 7. Milestone execution protocol

Start at Prompt 2 in `docs/v2/IMPLEMENTATION_ROADMAP.md` and continue sequentially through Prompt 28.

For every prompt:

1. Read the complete roadmap entry and all referenced decisions and specifications.
2. Inspect the current implementation created by previous prompts.
3. Write a concise internal milestone plan in `AUTONOMOUS_PROGRESS.md`.
4. Define measurable acceptance tests before implementation.
5. Implement the milestone completely.
6. Add or update:
   - Domain types.
   - Runtime validation.
   - Backend authorization.
   - Firestore rules and indexes when relevant.
   - Migrations and rollback notes when relevant.
   - Unit tests.
   - Integration tests.
   - Emulator tests.
   - E2E tests for critical user flows.
   - Arabic RTL UI states.
   - Accessibility behavior.
   - Documentation.
7. Run the relevant test and quality suite.
8. Diagnose and fix failures before continuing.
9. Perform a self-review for:
   - Security.
   - Cross-tenant access.
   - Data integrity.
   - Error handling.
   - Accessibility.
   - Performance.
   - Dead code.
   - Placeholder or fabricated behavior.
10. Update progress and decision logs.
11. Create a local commit named:
    - `P02: repository restructuring foundation`
    - continuing in this format through `P28`.
12. Continue automatically to the next prompt.

Do not stop between prompts for owner confirmation.

---

## 8. Quality gates

The quality gates defined after Prompts 6, 11, 17, 20, 24, 27, and 28 are mandatory.

At every gate:

- Run the complete relevant test matrix.
- Verify tenant isolation and deny-by-default authorization.
- Verify migrations are reversible and do not use production.
- Verify all sensitive commands are audited.
- Verify no client-controlled role or permission is trusted.
- Verify disabled users cannot retain access.
- Verify internal and client-visible data are separated.
- Verify file operations are private and validated.
- Verify no unresolved critical security issue was introduced.
- Verify documentation matches code.
- Verify the app builds from a clean install.
- Verify Arabic RTL, responsive behavior, keyboard access, and accessible dialogs on critical flows.
- Verify bounded queries, pagination, and index coverage.
- Verify error, loading, empty, and disabled-integration states.

If a gate fails:

1. Do not proceed.
2. Diagnose the failure.
3. Repair the implementation.
4. Repeat the gate.
5. Continue only after the gate passes.

An external service being unconfigured is acceptable only when a complete adapter, mock, feature flag, and user-facing configuration state exist and all local tests pass.

---

## 9. Engineering standards

### Security

- Deny by default.
- Verify organization membership and account state on every privileged request.
- Enforce permission, scope, resource organization, resource access, and business state in the backend.
- Use App Check or equivalent protections where appropriate.
- Use re-authentication for high-risk operations.
- Make MFA mandatory for privileged roles at launch configuration level.
- Never rely on hidden UI controls for authorization.
- Never log secrets or sensitive payloads.
- Use least-privileged service identities.
- Validate webhooks and prevent replay.
- Use rate limits, idempotency keys, correlation IDs, and safe error responses.
- Keep audit events append-only.

### Data

- Use canonical server-generated UTC timestamps.
- Use runtime schemas and typed converters.
- Avoid unbounded arrays and collections.
- Use cursor pagination.
- Preserve referential integrity through backend commands and transactions.
- Use soft deletion and archival according to the approved retention policies.
- Use schema versions and idempotent migration scripts.
- Do not silently discard ambiguous legacy data.

### Code quality

- No new `any` without a documented unavoidable boundary.
- No giant page components containing unrelated domain logic.
- Keep domain, application, infrastructure, and presentation boundaries clear.
- Avoid circular dependencies.
- Use shared design-system components.
- Keep API contracts versioned and typed.
- Remove obsolete V1 code only after functional replacement, migration coverage, and tests.
- Do not leave non-functional buttons or fabricated dashboard metrics.
- Feature-flag unfinished external integrations rather than pretending they work.

### UI and UX

- Arabic RTL is the primary experience.
- Keep English LTR readiness.
- Deliver professional visual hierarchy, responsive layouts, keyboard navigation, accessible focus management, and clear feedback.
- Implement list, Kanban, calendar, timeline, detail, approval, workload, reporting, administration, and client-portal experiences described in the blueprint.
- Use real data contracts.
- Include loading, empty, error, offline or unavailable, permission-denied, and integration-not-configured states.
- Dangerous actions require clear confirmations even though Codex itself has standing development approval.

### Testing

Use a compatible modern stack and include:

- Unit tests for domain rules.
- Authorization matrix tests.
- Firestore emulator security-rules tests.
- Backend integration tests.
- Migration dry-run and rollback tests.
- Contract tests for integrations.
- E2E tests for the critical roles and workflows.
- Accessibility checks.
- Performance and bundle checks.
- Concurrency and idempotency tests for workflow and approval engines.

Tests must never contact production.

---

## 10. Handling ambiguity and blockers

Do not ask questions for issues that can be resolved safely.

Use this order:

1. Approved decision.
2. Safest least-privileged interpretation.
3. Reversible implementation behind a feature flag.
4. Provider abstraction plus local mock.
5. Quarantine ambiguous migration records.
6. Document the choice and continue.

Only classify something as a hard blocker when all of these are true:

- It cannot be safely implemented with an abstraction, mock, emulator, fixture, feature flag, or deferred production configuration.
- It prevents further unrelated milestones.
- Continuing would cause data loss, a security vulnerability, or irreversible external impact.

When a hard blocker occurs:

- Record exact evidence and attempted remedies in `AUTONOMOUS_BLOCKERS.md`.
- Leave the repository in a clean, buildable, committed state.
- Continue all unaffected milestones.
- Stop only the dependency chain that is technically impossible.
- Do not stop the entire goal because one optional integration lacks credentials.

---

## 11. Context and interruption resilience

This is a long-running build. Preserve continuity in files, not only conversation context.

After every prompt, record:

- Status.
- Commit.
- Files and modules changed.
- Schema changes.
- Tests run and results.
- Open risks.
- Deferred production configuration.
- Exact next prompt.

If the session is interrupted or context is compacted:

1. Read `AUTONOMOUS_PROGRESS.md`.
2. Confirm Git status and last milestone commit.
3. Resume from the first incomplete acceptance criterion.
4. Do not restart completed prompts.
5. Do not discard working code merely because conversation history is unavailable.

Keep the project buildable at each committed checkpoint.

---

## 12. Completion definition

The autonomous goal is complete only when:

- Prompts 2–28 are implemented or explicitly marked as impossible due to a documented genuine external blocker.
- All mandatory quality gates pass.
- The V2 architecture is represented in code, not only documents.
- Authentication, backend authorization, tenant isolation, Firestore rules, audit, and migrations are tested.
- Organization, departments, teams, employees, clients, projects, workspaces, tasks, workflows, approvals, templates, comments, files, notifications, workload, time, attendance, leave, KPIs, reports, automation, AI proposal workflows, and client portal are implemented according to the roadmap.
- External providers without credentials have complete adapters, mocks, feature flags, and configuration states.
- No production deployment was performed.
- A clean install, type check, lint, test suite, emulator suite, E2E suite, and production build succeed.
- Security, performance, accessibility, backup, restore, monitoring, and launch documentation are complete.
- `AUTONOMOUS_FINAL_REPORT.md` contains evidence for every prompt and quality gate.
- A final local Git checkpoint is created.

---

## 13. Final deliverables

At the end, provide and record in `docs/v2/AUTONOMOUS_FINAL_REPORT.md`:

1. Executive summary.
2. Final architecture.
3. Completed prompt table from 1 to 28.
4. Local Git commits and checkpoints.
5. Files and packages created.
6. Database and index design implemented.
7. Migration tooling and rehearsal results.
8. Security controls and authorization evidence.
9. Test matrix and exact results.
10. Accessibility and responsive verification.
11. Performance and bundle results.
12. Dependency audit result.
13. External integrations implemented and their configuration status.
14. Feature flags.
15. Remaining non-code launch requirements.
16. Genuine hard blockers, if any.
17. Production deployment runbook.
18. Rollback and recovery runbook.
19. Confirmation that production data was untouched.
20. Confirmation that nothing was deployed.

Begin now with baseline preservation and Prompt 2. Do not return only a plan. Continue executing autonomously through Prompt 28.
