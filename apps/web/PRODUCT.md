# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Internal staff of an e-commerce company (design, product, campaigns, engineering teams) working through
ZAMAM daily, at a desk. Team is small (under ~30 people). Four roles, each with a distinct dashboard:
Owner (org-wide oversight), Manager (org-wide, department-agnostic), Department Lead (scoped to their own
department's people and tasks), Employee (their own current and upcoming work). Mobile use is secondary —
must not break, is not the primary design target.

## Product Purpose

ZAMAM is an internal task-pipeline tool. Its job is to move a piece of work through an ordered sequence of
steps, each step owned by a specific person or an entire department, until the task is done — and to make
that pipeline's state (who holds it now, who held it before, who's next) visible to everyone with a stake
in it, not just the current holder.

## Positioning

The differentiator is the multi-step pipeline model itself: a task is not a single assignee with a status,
it is a chain of steps, each independently assignable to a person or a department, where every past,
current, and future participant in that chain retains visibility into the whole thing. A generic
Kanban/to-do tool collapses this into one "assignee" field and loses the handoff history; ZAMAM's pipeline
view is built to make the handoff itself legible.

## Operating Context

- Task creation defines the step sequence up front (a step builder), each step assigned to a person or an
  "any active member of this department" group, with an optional per-step due date.
- The current step's holder acts on it (complete it, which advances the pipeline; or send it back to an
  earlier step with a reason).
- A "stalled" task — a step sitting past its due date, or past a default no-due-date threshold, with no
  status change — is a first-class signal surfaced on Owner/Manager and Department Lead dashboards.
- A WhatsApp reminder link (`wa.me`, no Business API integration) can be generated for whoever currently
  holds a step, since staff already coordinate over WhatsApp day-to-day.
- Direct member creation (an Owner/Manager fills a short form; the system generates a one-time temporary
  password) is the primary way new staff get access, alongside an existing invite-by-link flow.

## Capabilities and Constraints

- Full Arabic UI, right-to-left layout throughout — this is not a bilingual product with an RTL mode, it
  is Arabic-first.
- React 19 + Tailwind v4 web app already exists and is functional; this redesign is a visual rebuild on
  top of the existing component/routing structure, not a rewrite of application logic.
- Existing screens: Login, forced-password-change, role-scoped dashboard, tasks list/board, task
  creation flow, task detail with the step-pipeline view, member creation, team/employee directory,
  profile, reports/workload, notifications.
- Firebase Auth + Firestore backend (via Cloud Functions), already implemented and out of scope for this
  redesign — visual/frontend work only.

## Brand Commitments

- Product name: ZAMAM (زمام). Existing wordmark and icon assets are in
  `apps/web/src/assets/ZAMAM/` (`2-optimized.webp` full logo, `1T-optimized.webp` icon mark) — treat as
  binding, do not redesign the logo itself.
- Brand anchor color: `#004e66` (deep petrol teal), sourced from the parent company's e-commerce store,
  sabir511.com — use deliberately as an accent, not as a large background fill.
- Dark mode only. Warm dark charcoal background, never pure/near black.
- Visual quality reference: the clarity and functional color-coding of Asana/Monday.com, elevated into
  something distinctive rather than cloned. No single specific product's dark mode is a binding reference
  beyond that description.
- Existing type choice: Cairo (Arabic-native web font, already integrated) — carries forward as the base
  typeface; a heading/body pairing decision is a DESIGN.md concern, not settled here.
- Explicit anti-patterns to avoid: cream background + serif + terracotta accent; near-black + single neon
  accent; broadsheet/hairline-rule newspaper style; decorative numbered markers; purposeless
  gradients/glassmorphism; generic blue-and-white corporate SaaS look.

## Evidence on Hand

- Existing logo/icon assets at `apps/web/src/assets/ZAMAM/`.
- No additional brand guide, marketing site, or other product using this teal exists — the rest of the
  visual language (palette beyond the anchor, type pairing, elevation/shadow system, component style) is
  established fresh within the stated constraints, not extracted from an external reference.
- `docs/v2/UI_REDESIGN_AUDIT.md` records the incumbent (light-mode, different teal `#1B5E5A`) implementation
  as anti-reference evidence for this redesign — the old look is what is being replaced, not preserved.

## Product Principles

1. The pipeline is the product. Every screen that touches a task should make "where is this in its chain,
   and who's next" legible at a glance — this is the one thing ZAMAM does that a generic to-do tool doesn't.
2. Function over decoration. This is a daily-use internal tool for a small team, not a marketing surface —
   scanability and low cognitive load outrank visual flourish everywhere except the pipeline view itself.
3. RTL and Arabic are the default, not an accommodation. No component, icon, or layout decision should be
   authored LTR-first and mirrored as an afterthought.
4. One brand color, used with restraint. `#004e66` marks brand/primary action and nothing else competes
   with it — semantic status colors (stalled, priority, success/error) are a separate, deliberate system.
5. Dark mode is the only mode. Every surface, shadow, and status color is designed for a warm charcoal
   base from the start, not adapted from a light-mode default.

## Accessibility & Inclusion

No formal accessibility standard was specified as a hard requirement. Existing implementation already uses
semantic HTML and visible focus handling in places; carry forward and extend (visible focus rings,
sufficient contrast on dark surfaces, no color-only status signaling) as baseline craft, not a certified
compliance target.
