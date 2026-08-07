# ZAMAM UI Redesign — Audit

Scope: `apps/web/src` — AppShell, DashboardPage, TaskManagementPage (list/board/pipeline), Login,
CreateMemberDialog, ProfilePage, ForcePasswordChangeScreen. Audited against the
`redesign-existing-projects` skill's checklist.

## Framework and styling method

- React 19 + Tailwind v4 (`@theme` tokens in `apps/web/src/index.css`, `@import "tailwindcss"`), no CSS
  modules or styled-components.
- `framer-motion` is already a dependency (used sparingly — Login's error-message fade-in and loading
  spinner). `lucide-react` is the only icon set.
- RTL is already correctly set at the `html` level (`direction: rtl`) — this is structurally sound, not a
  gap. Font is Cairo (Google Fonts import), a real Arabic-native family, not a Latin font pretending to
  support Arabic.

**Verdict: styling stack stays as-is (Tailwind v4 + CSS variables + Cairo). This is a restyle, not a
framework migration.**

## Color and surfaces — biggest gap

Current tokens (`index.css`):
```
--color-zamam-primary: #1B5E5A   (a different, cooler teal than the brand's #004e66)
--color-zamam-navy: #1A2744
--color-zamam-light: #F0F5F4     (near-white background — full LIGHT MODE)
--color-zamam-textDark: #0A1628
--color-zamam-gray: #E0E8E6
```

- **Entire app is light mode.** Body background `#F0F5F4`, cards `bg-white`, text near-black. The brief
  requires dark mode only, warm charcoal (never pure black). This is not a tweak — every surface color in
  every screen needs to flip.
- **Brand teal is wrong.** `#1B5E5A` is close to but not the specified `#004e66`. Needs a full token swap,
  plus tints/shades derived from the new hex for hover/active/subtle-background states (currently only one
  manual hover shade exists: `#164D49`).
- **Glassmorphism present and explicitly called out as an anti-pattern to avoid.** `index.css` defines
  `.glass-panel` / `.glass-card` utility classes (`backdrop-blur-md`, `bg-white/70/80`) — not currently used
  in the screens I read, but they exist and invite exactly the "purposeless glassmorphism" pattern the
  brief says to avoid. Remove these utilities rather than restyle them for dark mode.
- **Semantic status colors are ad hoc Tailwind defaults, not a system.** Stalled tasks use
  `border-red-300 bg-red-50`, urgent priority uses `bg-red-100 text-red-800`, the WhatsApp-missing banner
  uses `bg-amber-50 border-amber-300`, success states use `text-green-700`. None of these are theme
  tokens — they're inline Tailwind gray/red/amber/green defaults scattered per-component. DESIGN.md needs
  to define one success/warning/danger/neutral set and every screen needs to switch to it.
- **Shadows are generic, untinted black at low opacity** (`shadow-card: 0 1px 2px rgba(0,0,0,0.2)`,
  `shadow-glass`). On a dark charcoal background these read as mud, not depth. Needs colored/tinted shadows
  per the brief's dark-mode requirement.

## Typography

- Cairo is a good, deliberate choice (not "browser default or Inter everywhere") and should stay as the
  Arabic-native heading+body font — but it's used as a single family/weight scale, no distinct heading vs.
  body pairing, no tabular figures for the data-dense dashboard/task-list numbers (task counts, stalled
  counts appear in plain proportional digits).
- Headline sizing is inconsistent across screens: Login uses `text-3xl lg:text-4xl font-black`, Dashboard
  uses `text-2xl font-black`, Task list uses `text-2xl font-black` too, page-level `<h2>`s inside dialogs
  drop to `text-lg`/`text-xl` with no clear scale — feels ad hoc rather than a deliberate type scale.
- No `text-wrap: balance/pretty` anywhere; Arabic headline wrapping wasn't considered.

## Layout

- **Sidebar-left dashboard shell** (AppShell) is the standard/expected pattern for an internal tool — audit
  guidance to "try top nav or floating command menu instead" does not apply here; a persistent sidebar is
  correct for a multi-department daily-use tool and should be kept, just restyled for dark mode with a
  distinctive treatment (not a plain white rail).
- **Generic 3-up-feels layout patterns appear in dashboard cards**: `SummaryBar` in DashboardPage.tsx is a
  flat `grid-cols-2 sm:grid-cols-4` of equal-height bordered boxes with a label + big number — functional,
  but visually identical to a hundred other admin dashboards. This is the single highest-value target for a
  distinctive treatment (see pipeline note below — the task detail view is the signature screen, but the
  dashboard summary is the most-seen screen).
- **Task cards (`TaskRowCard` in DashboardPage.tsx, list items in TaskManagementPage.tsx) are the textbook
  "generic card": border + light shadow + white background**, exactly what the audit flags. No hierarchy
  device beyond a priority-colored pill badge.
- Modals are used for every create/edit action (task create/edit, member create, send-back). For a
  fast-moving internal tool this is probably fine functionally (audit's "modals for everything" concern is
  more about marketing/consumer UX) — recommend keeping modals but giving the task detail's pipeline a
  non-modal, first-class full-screen treatment since it's the signature interaction.

## Interactivity and states

- Hover/active states exist in most places (`hover:bg-gray-50`, `active:scale-95` on Login's button) but
  are inconsistent — many buttons in TaskManagementPage/DashboardPage/CreateMemberDialog have no active/press
  feedback at all, just a hover background swap.
- **Loading states are a single spinner + Arabic "جارٍ ..." text everywhere** (`LoaderCircle` +
  `animate-spin`), no skeleton loaders matching the eventual layout shape. For the dashboard and task list
  specifically, a skeleton would read as much more finished.
- **Empty states exist and already have a call-to-action in most places** (e.g. "لا توجد مهام ضمن نطاقك"),
  which is good — but they're plain centered text, no illustration/visual weight. Not a functional gap, a
  polish opportunity.
- Error states are inline (`role="alert"`, red text) — correctly not using `window.alert()`. Good, keep
  this pattern, just restyle the color for dark mode.
- Focus rings: not explicitly styled anywhere (relying on browser default) — needs an explicit, visible,
  on-brand focus ring per accessibility requirement, especially important since forms are RTL and the
  default outline can look misplaced.

## Content

- Arabic labels throughout are specific and real (e.g. "قائد قسم (إنشاء مهام لقسمه فقط)"), not
  lorem-ipsum-adjacent — good foundation, subagents should keep this standard, not regress it with
  generic placeholder text when adding new copy.
- No fake round numbers or placeholder company names found in the reviewed screens (this is an internal
  tool with real org data, not marketing copy) — low risk here, but subagents populating any new sample
  screenshots/mocks during development should still use realistic, varied test data per the skill's rule
  (never "Test User 1", never identical dates).

## Component patterns specific to this app

- **The task detail pipeline view** (`StepPipeline` in TaskManagementPage.tsx) is functionally rich
  (ordered steps, current-step highlight, WhatsApp reminder button, inline due-date editor, complete/send
  -back actions) but visually it's a plain vertical list of bordered rows with a colored left accent on the
  active step. This is the app's one truly distinctive feature (multi-step pipeline where past/current/
  future assignees can all see the chain) and currently looks like a generic to-do list. **This is
  Phase 4/Subagent F's highest-priority target** — the brief is right to give it its own dedicated
  subagent and the most design attention.
- **Priority badges** (`PriorityBadge`, added this session) are flat `bg-{color}-100 text-{color}-800`
  pills — functional, low-risk to restyle, good candidate for the semantic-color-token pass.
- **Avatar circles**: the profile menu uses a gradient teal→navy circle with an initial letter — fine
  pattern, just needs the new brand teal.
- **Notification bell dropdown / profile menu dropdown**: both are plain white bordered panels with a
  drop-shadow — need dark-mode surfaces and the new elevation/shadow language.

## Code quality

- Semantic HTML is already used correctly (`<main>`, `<nav aria-label=...>`, `<header>`, `<aside>`) — no
  div-soup problem.
- No hardcoded pixel widths found in the reviewed files; Tailwind's relative-unit classes are used
  throughout.
- No arbitrary `z-index: 9999` values found; dropdowns use `z-40`/`z-50` consistently.
- `alt` text: the ZAMAM logo images in Login have `alt="ZAMAM Logo"` / `alt="ZAMAM Icon"` — acceptable.

## What's structurally fine and just needs restyling (low risk)

- AppShell's sidebar/header structure, RTL setup, semantic HTML, routing, all interactive logic (nav
  active-state, dropdown open/close, form validation, empty/error states existing at all).
- Login's two-panel layout structure.
- Task list's master-detail layout (sidebar list + detail pane).
- Dashboard's section structure (summary bar → stalled section → role-scoped task sections).

## What needs a genuine visual rebuild, not just restyling (higher design effort)

- Every color token (full dark-mode palette from a warm charcoal base + the new #004e66 teal + a real
  semantic status system) — this is DESIGN.md's job, then a mechanical-but-extensive pass across every
  screen.
- The task detail pipeline view's visual language (Subagent F, signature screen).
- Dashboard's `SummaryBar` and task cards — currently generic bordered boxes, need a distinctive treatment
  that still reads instantly (Asana/Monday-level clarity, not decoration for its own sake).
- Shadow/elevation system (tinted, not generic black).
- A defined type scale (display/heading/body/label sizes with consistent weight steps) replacing today's
  ad hoc per-screen sizing.

## Anti-patterns already avoided (do not introduce them while redesigning)

- Not using Lucide-only would be a regression in consistency for zero benefit — Lucide is fine here, this
  is an internal tool, not a marketing site chasing distinctiveness through icon choice. Keep Lucide.
  (Explicitly overriding the generic skill guidance on this one point — icon library choice is not worth
  the churn for an internal dashboard.)
- RTL is already correct — do not accidentally introduce LTR-authored components that need mirroring.
- No lorem ipsum, no placeholder company names, no "Acme Corp" — keep it that way.

## Priority order for Phase 4 (per the redesign skill's own fix-priority guidance, adapted)

1. Color palette (DESIGN.md tokens) — everything downstream depends on this being finalized first.
2. Task detail / pipeline view (signature screen, most design budget).
3. Owner/Manager dashboard (most-seen screen, summary + stalled section + quick actions).
4. Tasks list/board (second most-seen).
5. Login + forced password-change (first impression, low complexity).
6. Task creation flow, Add-member modal, Team page (functional forms, moderate visual opportunity).
7. Reports/Workload + notifications panel (lowest-traffic screens, still needs the same token system
   applied for consistency).
