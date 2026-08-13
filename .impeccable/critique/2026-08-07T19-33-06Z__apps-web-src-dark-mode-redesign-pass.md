---
target: ZAMAM dark-mode redesign pass (22 files)
total_score: 22
max_score: 36
na_heuristics: 10
p0_count: 2
p1_count: 4
timestamp: 2026-08-07T19-33-06Z
slug: apps-web-src-dark-mode-redesign-pass
---
# ZAMAM Dark-Mode Redesign — Design Critique

Method: dual-agent (A: design-review sub-agent · B: detector+evidence sub-agent), plus supplemental live-browser verification performed directly in the parent context using the running Firebase emulator + Vite dev server that Assessment B discovered already active, with recovered local emulator credentials (`owner@zamam.local`). This verification is disclosed inline below wherever it corroborates or overturns a sub-agent claim; no `detect.js` overlay was injected into the live page, so no user-visible overlay claim is made — the evidence below is direct authenticated screenshots and DOM inspection, not an injected overlay.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2/4 | Dead "المهام الفرعية"/"قائمة التحقق" tabs on the signature pipeline screen give zero feedback on click (confirmed live: plain `<span>`, `cursor: auto`, no handler) |
| 2 | Match Between System and Real World | 4/4 | Arabic-native domain vocabulary throughout, no translated-English tell |
| 3 | User Control and Freedom | 2/4 | No modal in the app closes on Escape or traps focus; dashboard send-back offers no target-step choice |
| 4 | Consistency and Standards | 1/4 | The same "task row" object is fully clickable in `TasksListView.tsx` but has **zero** click-through to task detail in every dashboard variant (`TaskRowCard` in `dashboard/shared.tsx` is a bare `<article>`, no `onClick`/`Link`, confirmed live) — plus duplicate `PriorityBadge` implementations, two structurally different send-back flows, inconsistent button micro-states |
| 5 | Error Prevention | 3/4 | Forms constrain input well; the dashboard's native `window.prompt()` send-back has none of the same guardrails as `SendBackDialog` |
| 6 | Recognition Rather Than Recall | 3/4 | Task rows surface rich info inline, but the dashboard's summary can't be acted on directly — user must re-find the same task in a different screen to reach its pipeline |
| 7 | Flexibility and Efficiency of Use | 2/4 | List/board/calendar/timeline views and saved filters are genuinely good; undercut by the extra mandatory hop from dashboard to pipeline and by keyboard/focus gaps |
| 8 | Aesthetic and Minimalist Design | 3/4 | Generally restrained and on-brief; `TeamPage.tsx` stacking a second full-width header bar on top of the page's own header adds unintended visual noise |
| 9 | Help Users Recognize, Diagnose, and Recover from Errors | 2/4 | Errors are visually well-formed but generic ("تعذر حفظ المهمة. راجع الحقول المطلوبة.") — never names which field or what failed |
| 10 | Help and Documentation | n/a | No help system exists; legitimate scope exclusion for a <30-person internal tool with no stated help/certification target, not a gap |
| **Total** | | **22/36** | **Acceptable (61%)** |

Nine heuristics scored (10 is n/a), so the applicable maximum is 36, not 40. 22/36 = 61%, which lands in the "Acceptable — significant improvements needed before users are happy" band (50–69%).

## Design Specificity Verdict

**Start here — does this feel authored for ZAMAM, or category-interchangeable?**

**LLM assessment (Assessment A):** Genuinely bespoke at the token/architecture layer — `index.css` implements DESIGN.md's exact color/radius/shadow/type table as CSS custom properties, including the specified tinted shadow formula and a real motion vocabulary. `TaskDetailPipeline.tsx`'s `StepPipeline` adds a `sent_back` node state DESIGN.md never specified but the domain clearly needed — evidence of actual design thinking, not template-filling. Arabic domain vocabulary is precise throughout (`مسار الخطوات`, `إرجاع خطوة`, `متعثرة`), and the WhatsApp-reminder deep link is tailored to how this specific team coordinates. Where it slides toward generic: `DashboardPage.tsx`'s send-back handler is a raw `window.prompt()` — the least-branded UI primitive available, and the opposite of "authored for ZAMAM." Six of seven full-page loading states still ship the exact spinner pattern DESIGN.md names and explicitly retires. Physical (`pr-`, `mr-`) and logical (`ps-`, `pe-`) Tailwind utilities sit side by side in the same files, a tell that RTL-first wasn't uniformly internalized even though the app never runs LTR.

**Deterministic scan (Assessment B):** `detect.mjs --json` run against all 22 files, DESIGN.md auto-loaded as local context. Exit code 2 (findings present). Two findings total, both `severity: warning`, `category: slop`:
- `side-tab` — `TasksListView.tsx:73`, `border-r-2` on a timeline-style task row. Sanity check: plausible true positive on pattern-match grounds (a repeated colored accent border per list item is exactly what the rule targets), but contextually defensible — it's a deliberate timeline rail/spine-and-node pattern, not a random AI-slop card accent. Judgment call, not a clear defect.
- `border-accent-on-rounded` — `TeamPage.tsx:30`, `border-b-2` on a `rounded-t-md` tab link. Sanity check: likely false positive — this is the standard underline-tab pattern (rounding on top, border on bottom, opposite edges, no geometric clash); the rule's stated rationale doesn't actually hold for this instance.

No regex misfires on Arabic text or unrelated JSX tokens in either finding — a very clean detector run for 22 files, which itself is a mild positive signal (no gradient/glassmorphism/pure-black violations, no un-tinted `box-shadow` matches).

**Live verification (supplemental, this pass):** Logged into the real running app (Owner role, `org-demo` seed data) via Playwright using recovered local emulator credentials. Confirmed by direct interaction:
- The login screen and Owner dashboard render exactly as DESIGN.md specifies — warm charcoal, restrained teal, redundant-on-purpose stalled-task signaling (screenshots on file).
- **New finding neither sub-agent caught**: none of the three dashboard variants (`OrganizationDashboard.tsx`, `DepartmentDashboard.tsx`, `EmployeeDashboard.tsx`) pass any navigation into `TaskRowCard`, and `TaskRowCard` itself (`dashboard/shared.tsx:44`) has no `onClick`/`href` on the card or title. Clicking a task's title/row on any dashboard does nothing. The only way to reach a task's pipeline detail is to navigate to the separate Tasks list and find the same task again. Confirmed by DOM inspection (`grep`-level source read plus live click-through attempts that consistently landed nowhere).
- Confirmed live, via `getComputedStyle`, that `TaskDetailPipeline.tsx`'s "المهام الفرعية"/"قائمة التحقق" tabs are inert: `<span class="... text-text-tertiary">`, `cursor: auto`, no click handler — exactly as Assessment A predicted from static reading, now proven at runtime.
- The seeded demo tasks are all single-step ("مسار الخطوات (1/1)"), so the multi-step connected-rail visual — the actual signature moment DESIGN.md describes — was not directly observable in this data set; this is a seed-data limitation of this verification pass, not a claim the multi-step rendering is broken (the code for it was read and looks correct per Assessment A).

Net verdict: this is a legitimate, deliberate ZAMAM system at the token/architecture level, let down by inconsistent depth of execution per screen and — this pass's most important addition — a live-confirmed break in the app's most basic navigational promise: you cannot get from "here's a task that needs attention" (dashboard) to "here's its pipeline" (the signature screen) in one click, from any role's dashboard.

## Overall Impression

The bones are right and the polish is real in places — the token system, the pipeline node mechanic, and the temp-password reveal moment all show a team that read DESIGN.md and PRODUCT.md and tried to honor them, not just reskin a template. But this reads like eight competent people who shared a stylesheet and not much else: the single biggest opportunity here isn't more visual polish, it's an integration pass. The most damaging problems in this review are not "wrong color" or "clashing radius," they're **structural gaps between screens that were clearly built by different hands** — a task row that's clickable in one screen and inert in another, a send-back action that's a real modal in one entry point and a browser `alert()` in another, a signature screen with two tabs that look real and do nothing. None of these are hard to fix; all of them are the kind of thing a final cross-screen QA pass exists to catch, and the evidence (6-of-7 screens on the retired spinner pattern, specifically) suggests that pass either didn't happen or checked a narrower list than DESIGN.md actually specifies.

## What's Working

1. **The design-token system is real, not decorative.** `apps/web/src/index.css` implements DESIGN.md's color/radius/shadow/type table almost verbatim, plus a shared motion vocabulary (`animate-panel-in`, `animate-node-settle`) with a `prefers-reduced-motion` kill-switch, used consistently across all 22 files reviewed. Live screenshots of the login screen and Owner dashboard confirm it renders exactly as specified — warm charcoal base, restrained teal, no rogue gradients or glassmorphism.
2. **Stalled-task signaling on the Owner/Manager dashboard is genuinely scannable.** Confirmed both in source and live: a dedicated red-headed "مهام متعثرة" section renders before anything else, each `TaskRowCard` independently reinforces stalled status with a red border + pill, and `OrganizationDashboard.tsx` groups the remainder by priority tier with color + count. A user can tell "what needs attention" in under a second, per PRODUCT.md's scanability principle — this is the strongest hierarchy result in the review.
3. **The temp-password reveal screen (`CreateMemberDialog.tsx`) is the one moment that visibly reasoned about its own stakes** — dedicated icon, explicit "won't be shown again" warning, bordered password well, working copy-with-confirmation. It's undermined by one missing guardrail (see Priority Issues) but the visual/tonal execution is the best in the app.

## Priority Issues

**[P0] Dashboard task cards have no click-through to the task's pipeline — confirmed live**
- **What:** `TaskRowCard` (`apps/web/src/features/dashboard/shared.tsx:44`) renders as a plain `<article>` with no `onClick`, no `href`, no `Link`. None of `OrganizationDashboard.tsx:24`, `DepartmentDashboard.tsx:30`, or `EmployeeDashboard.tsx:37/61` pass any navigation prop into it. Verified live: clicking any task title or card body on the Owner dashboard does nothing; the only way to open that task's pipeline is to go to the separate Tasks screen and locate it again there (where `TasksListView.tsx`'s equivalent rows *are* correctly wired to `onSelectTask`).
- **Why it matters:** PRODUCT.md's core promise is "the pipeline is the product" and that a task's chain state should be visible to everyone with a stake in it. The dashboard is the highest-traffic screen for every one of the four roles, and it's precisely the screen that should turn "I can see this needs attention" into "let me go look at where it actually is" in one click. Instead every dashboard glance that surfaces something actionable dead-ends, forcing a manual re-find in a different view — for a tool opened "dozens of times a day," per DESIGN.md's own framing, this is a real, repeated tax, not an edge case.
- **Fix:** Wrap `TaskRowCard`'s title (or the whole `<article>`) in a `Link`/`onClick` that navigates to `/tasks` with the task pre-selected (the existing `setSelectedId` mechanism in `TasksListView.tsx:153` already does exactly this locally — expose it via a route param or shared navigation helper so the dashboard can trigger the same selection).
- **Suggested command:** `/impeccable harden`

**[P0] Send-back via native `window.prompt()` bypasses the entire design system**
- **What:** `DashboardPage.tsx:76`'s `sendBack()` handler: `const reason = window.prompt('سبب إرجاع الخطوة؟')`, then always targets `Math.max(0, row.currentStepOrder - 1)` — no choice of target step. This is wired to the "إرجاع خطوة" button on `EmployeeDashboard.tsx:39`.
- **Why it matters:** DESIGN.md's Motion section calls out send-back by name as a signature state transition that should be visibly animated on the pipeline. A bare OS dialog is unbrandable, un-RTL-styleable, can't be localized beyond its one string, and functionally can't target more than one step back — while `TasksListView.tsx`'s `SendBackDialog` (a proper modal with a step picker and required reason field) already exists and does this correctly. The same domain action behaves completely differently depending on which button a user happens to click.
- **Fix:** Delete the `window.prompt` path; have `DashboardPage.tsx` open the same `SendBackDialog` component `TasksListView.tsx` already uses.
- **Suggested command:** `/impeccable harden`

**[P1] Pipeline step-count display is wrong on terminal/cancelled tasks**
- **What:** `TaskDetailPipeline.tsx:61`: `` مسار الخطوات ({task.currentStepOrder + (isTerminal ? 1 : 1)}/{task.stepCount}) `` — both branches of the ternary add `1`, so the counter always shows one step further along than the task's actual `currentStepOrder`, regardless of whether it's terminal.
- **Why it matters:** This is a specific, findable defect in exactly the copy meant to answer "where is this task right now" — DESIGN.md's stated core promise for the one screen that's supposed to get the most design attention in the whole app.
- **Fix:** Correct the ternary logic (likely intended `isTerminal ? task.stepCount : task.currentStepOrder + 1`), and add a test covering a cancelled/archived task mid-chain.
- **Suggested command:** `/impeccable harden`

**[P1] Dead, unlabeled tabs on the signature screen — confirmed live via DOM inspection**
- **What:** `TaskDetailPipeline.tsx:164-165` — "المهام الفرعية" and "قائمة التحقق" render as plain `<span>`s styled identically to the working "نظرة عامة"/"التعليقات والنشاط" tabs beside them. Confirmed at runtime: `cursor: auto`, no click handler, no `aria-disabled`, no tooltip.
- **Why it matters:** On the app's flagship screen, a user clicks what visually presents as a tab and gets total silence — no state change, no explanation. This directly undercuts "visibility of system status" on the one screen DESIGN.md said should get the most care, and erodes trust that the rest of the screen's affordances are real.
- **Fix:** Either wire the tabs to real (even empty-state) content, or mark them visibly inert (`aria-disabled`, reduced opacity, a "قريبًا" tooltip) so their non-function is legible rather than silent.
- **Suggested command:** `/impeccable harden`

**[P1] Six of seven full-page loading states still use the retired spinner pattern**
- **What:** `DashboardPage.tsx:66`, `EmployeeDirectoryPage.tsx:137`, `OrganizationAdminPage.tsx:129`, `WorkloadPage.tsx:87`, `ReportsPage.tsx:42`, `NotificationCenterPage.tsx:65` all render `<LoaderCircle className="animate-spin" /> جارٍ ...`. Only `TasksListView.tsx:156-167` implements the content-shaped skeleton DESIGN.md mandates (confirmed live — this skeleton is real and looks good in the running app).
- **Why it matters:** DESIGN.md states this replacement is "fixed as part of this redesign, not optional polish." One-of-seven compliance on an explicit, named requirement is the single clearest fingerprint that the parallel subagents shared a stylesheet but not a checklist.
- **Fix:** Port `TasksListView.tsx`'s skeleton pattern (or extract a shared `PageSkeleton` primitive) to the other six loading states.
- **Suggested command:** `/impeccable polish`

**[P1] Temp-password dialog can be dismissed before the password is ever copied**
- **What:** `CreateMemberDialog.tsx:69-76` — the "تم" button that closes the dialog is enabled regardless of whether `copied` is true.
- **Why it matters:** This is explicitly the moment the product brief flags as highest-stakes: a lost temp password locks a new hire out. The visual treatment (warning banner, bordered password well, copy confirmation) is the best in the app, but there's no behavioral guardrail matching the stated risk — a fast-reading Owner can click through without ever pressing Copy.
- **Fix:** Disable/soften "تم" until `copied === true`, or show an inline "هل نسخت كلمة المرور؟" confirm step before allowing close.
- **Suggested command:** `/impeccable harden`

**[P2] TeamPage stacks a duplicate header bar on its child pages**
- **What:** `app/TeamPage.tsx:23-37` renders its own `border-b border-border-subtle bg-surface` tab strip directly above `EmployeeDirectoryPage.tsx:145`'s or `OrganizationAdminPage.tsx:153`'s own independent `<header className="border-b border-border-subtle bg-surface">`. The detector's `border-accent-on-rounded` flag on `TeamPage.tsx:30` is a false positive on its own, but it did point at the exact file where this real duplicated-chrome problem lives.
- **Why it matters:** Two back-to-back full-bleed surface bars each with their own border/padding reads as broken or duplicated navigation, not one coherent page — unnecessary scanability tax on a routine admin screen.
- **Fix:** Strip the inner `<header>` when these screens render inside `TeamPage`, or fold the tab strip into the existing header as a secondary nav row.
- **Suggested command:** `/impeccable polish`

## Persona Red Flags

**Alex (power user, dashboard/admin-appropriate):**
- The missing dashboard→pipeline click-through (P0 above) is Alex's worst nightmare: they live on the dashboard, see something needs attention, and every single time have to break flow, switch to a different screen, and re-find the same task by scanning a list. For a tool used dozens of times a day, this is exactly the kind of friction that pushes a power user to build a workaround (bookmark the Tasks URL, ignore the dashboard) rather than trust the primary surface.
- No keyboard shortcuts anywhere, no Escape-to-close on any of the six dialogs in the app (`TaskEditor.tsx`, `CreateMemberDialog.tsx`, `SendBackDialog`, `InviteDialog`, `DisableDialog`, `CreateDialog`) — Alex has to mouse to a small X every time.

**Sam (accessibility/keyboard/screen reader, dashboard/admin-appropriate):**
- Confirmed live: no modal traps focus or closes on Escape, so a keyboard user can Tab straight through an open dialog into the page behind it.
- `CreateMemberDialog.tsx:25` declares a `firstInput` ref wired to the name field's `ref` prop, but the corresponding `.focus()` call in a mount effect is simply missing — present in the near-identical `InviteDialog` (`EmployeeDirectoryPage.tsx:33`) and `CreateDialog` (`OrganizationAdminPage.tsx:35`), absent here. A screen-reader/keyboard user opening "إضافة عضو" gets no focus movement into the dialog at all.
- Positive to credit: `index.css`'s global `:focus-visible` outline (`2px solid var(--color-brand-400)`, correctly skipped for mouse clicks) is applied genuinely app-wide — an easy thing for a redesign to skip, and it wasn't skipped here.

**Jordan (first-timer):**
- `TaskDetailPipeline.tsx`'s dead tabs (confirmed live) will read as "this app is broken," not "this feature doesn't exist yet," on the very first task Jordan opens.
- A first-time employee who's only seen ZAMAM's on-brand, Arabic, dark UI gets a jarring plain OS `window.prompt()` the moment they try to send back a step from the dashboard — right at a moment (rejecting someone else's work) that's already a little socially uncomfortable.

## Minor Observations

- The dashboard's "مهام متعثرة" (stalled) summary tile renders in full danger-red styling even when the count is genuinely `0` (confirmed live, Owner dashboard screenshot). Always-red regardless of value dilutes the signal exactly when it matters — consider a neutral/muted treatment at zero so the red is reserved for when there's something to actually worry about.
- `EmployeeDashboard.tsx`'s "مهامك الحالية" (current) vs. "قادمة إليك" (upcoming) distinction reads clearly and doesn't need fixing — it differentiates on icon color, count-pill fill, presence/absence of action buttons, and an explanatory subtitle ("للاطلاع فقط — تصبح قابلة للتنفيذ بعد اكتمال الخطوة التي تسبقها") all at once. Worth calling out as a pattern to reuse elsewhere in the app, not just leave alone.
- Two independently-maintained, byte-identical `PriorityBadge` components exist (`dashboard/shared.tsx:14-22` and `tasks/shared.tsx:17-26`) — consistent today by coincidence of copy-paste, not by construction.
- Button micro-states (`cursor-pointer`, `active:` pressed color) are present on some primary buttons (`TasksListView.tsx`, `TaskEditor.tsx`) and missing on others doing the same job (`DashboardPage.tsx:93-94`'s header buttons), and even within the same file (`CreateMemberDialog.tsx`'s form-stage buttons have them, its reveal-stage buttons don't).
- Physical Tailwind utilities (`pr-`, `mr-`) sit next to logical ones (`ps-`, `pe-`) in the same files (e.g. `TasksListView.tsx`) — harmless today since the app never runs LTR, but a tell that RTL-first wasn't uniformly internalized.
- `ProtectedRoute.tsx:11`'s auth-loading gate renders a totally blank `<main aria-busy="true" />` with zero visual feedback — likely fine given it's sub-second in practice, but it's the one loading state in the app with no content at all.
- The seeded demo data used for this pass only contains single-step tasks, so the multi-step connected-rail visual (the actual "chain" DESIGN.md describes as the signature moment) couldn't be directly observed live in this pass — worth a follow-up check with a genuinely multi-step task once more realistic data exists.

## Questions to Consider

1. If six of seven loading screens still ship the exact pattern DESIGN.md names and says to eliminate, and one of the app's four dashboard variants has zero navigation wired into its primary card component, was there an actual cross-screen integration/QA pass after the eight parallel subagents finished, or did each subagent's output only get checked against its own assigned screen in isolation?
2. Send-back is one of only two core pipeline actions (alongside complete) and gets its own Motion-section callout in DESIGN.md — why does it have two structurally different implementations reachable from two different buttons that are supposed to do the same thing? Was the dashboard's quick-action wired before `SendBackDialog` existed and never revisited?
3. The temp-password dialog is the one screen that visibly asked "what's the failure mode if the user rushes through this?" — what would it take to ask that same question about the dashboard's dead-end task cards and the pipeline's dead tabs, both of which fail exactly the same way (silent, no recovery) but on screens used far more often?
