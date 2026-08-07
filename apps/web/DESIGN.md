# Design

<!-- impeccable:design-schema 1 -->

This is a **redesign** of an existing, functional product (see `docs/v2/UI_REDESIGN_AUDIT.md` for the
incumbent light-mode implementation, kept only as anti-reference). Mode: **Operate** throughout — every
screen is a task surface, not a persuasion surface. Color strategy: **Restrained** (neutrals + one brand
accent), the Operate-mode default, and also what the brief itself pins.

The brand direction below was agreed with the product owner before this redesign started and is treated
as **pinned** — not a candidate among alternatives. Per Product Principle 1, the pipeline (multi-step task
chain) is the one thing this product does that a generic to-do tool doesn't; every token and pattern below
exists to keep that legible, not to decorate it.

## Color

Dark mode only. Warm charcoal base (a hint of brown/amber in the neutrals, never blue-black, never pure
`#000`). Elevation is communicated primarily through surface-color steps and thin borders, not drop
shadows — shadows barely read against a dark ground, so they're reserved for genuinely floating elements
(dropdowns, modals) that need separation from whatever's behind them.

### Neutrals (warm charcoal ramp)

| Token | Hex | Use |
|---|---|---|
| `--bg-canvas` | `#15171A` | Page background |
| `--bg-sidebar` | `#101214` | Sidebar/header — the "second neutral layer," slightly darker/cooler than content so it reads as a distinct plane |
| `--bg-surface` | `#1D2023` | Cards, list rows, panels |
| `--bg-surface-raised` | `#242730` | Modals, dropdowns, popovers — one step lighter, the floating layer |
| `--bg-surface-hover` | `#282C30` | Hover state on rows/cards |
| `--border-subtle` | `#2A2E33` | Default dividers, card borders |
| `--border-strong` | `#3A3F45` | Input borders, focus-adjacent borders |
| `--text-primary` | `#EDEEEE` | Headings, primary content — warm off-white, never pure `#FFF` |
| `--text-secondary` | `#9CA3AA` | Supporting text, metadata, labels |
| `--text-tertiary` | `#6A7178` | Placeholder, disabled, least-important text |

### Brand accent — `#004e66` (deep petrol teal)

| Token | Hex | Use |
|---|---|---|
| `--brand-600` | `#00344A` | Pressed/active state |
| `--brand-500` | `#004E66` | The anchor itself — large filled elements (primary buttons) |
| `--brand-400` | `#1D7A99` | Larger/non-text accent use (rings, borders, icons ≥ 24px) — fails AA text contrast on `--bg-canvas`/`--bg-surface` at small sizes, so never use for body-size or label-size text |
| `--brand-300` | `#4FA3C0` | Small text/label use on dark surfaces (eyebrow labels, links, current-step text) — meets 4.5:1 where `--brand-400` does not |
| `--brand-subtle-bg` | `#122A33` | Selected-row / active-nav-item background (brand at low presence, not full-strength fill) |

Accent is used for **primary actions, current selection/current-step indication, and links only** — never
for decoration, never as a large background fill (Product Principle 4). A whole card or section filled
with `--brand-500` is a violation of this system, not a bold choice.

### Semantic status (a separate system from brand — do not reuse brand teal for these)

| Role | Text/icon | Background tint | Used for |
|---|---|---|---|
| Success | `#4ADE9A` | `#132A21` | Completed step, saved confirmation |
| Warning | `#E3A94A` | `#2B2214` | "مهم" priority, approaching due date |
| Danger | `#F0685F` | `#2E1917` | "عاجل" priority, stalled-task flag, destructive actions, errors |
| Neutral badge | `--text-secondary` | `--bg-surface-hover` | "عادي" priority, informational badges |

Priority is the existing 4-value backend enum (`low/medium/high/urgent`) rendered as 3 visual tiers:
low+medium → Neutral, high → Warning, urgent → Danger. Stalled uses Danger. Never introduce a second red
or a second amber — one hex per semantic role, everywhere.

## Typography

Single family: **Cairo** (already integrated, Arabic-native, weights 300–900 loaded) — per Operate-mode
guidance, product UI rarely needs a second display face, and Cairo's weight range already gives enough
hierarchy without one. Fixed `rem` scale, not fluid/`clamp()` — this is a desktop-first internal tool
viewed at consistent DPI, not a responsive marketing page.

| Token | Size | Weight | Use |
|---|---|---|---|
| `--text-display` | 1.75rem / 28px | 800 | Page-level title (one per screen, e.g. "لوحة التحكم") |
| `--text-h1` | 1.375rem / 22px | 800 | Section headings |
| `--text-h2` | 1.125rem / 18px | 700 | Card/panel titles, modal titles |
| `--text-h3` | 1rem / 16px | 700 | Sub-section labels |
| `--text-body` | 0.9375rem / 15px | 500 | Default body/UI text — Cairo reads slightly light at 400 for UI density, 500 is the floor |
| `--text-label` | 0.8125rem / 13px | 600 | Form labels, table headers, small buttons |
| `--text-caption` | 0.75rem / 12px | 600 | Timestamps, helper text, badges |

Scale ratio ≈1.15–1.2 between steps (tight, per Operate-mode guidance — this is a data-dense tool, not an
editorial page). All numeric data (task counts, dates, phone numbers) uses
`font-variant-numeric: tabular-nums` so columns of numbers align — the one idea worth keeping from the
ui-ux-pro-max cross-check's "dashboard/analytics" font mood, applied as a CSS property rather than a font
swap. Arabic headline wrapping uses `text-wrap: pretty` where supported.

## Spacing and radius

4px base unit: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Radius is deliberately **tighter on inner elements,
softer on containers** (redesign-audit guidance, not currently followed anywhere in the incumbent UI):

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 6px | Badges, small buttons, inputs |
| `--radius-md` | 10px | Buttons, cards, list rows |
| `--radius-lg` | 16px | Modals, large panels |
| `--radius-full` | 9999px | Avatars, status dots |

## Elevation

No generic `box-shadow: 0 Npx Npx rgba(0,0,0,0.1)` anywhere (the incumbent's exact pattern — see audit).
Two elevation mechanisms only:

1. **Surface-color step** (`--bg-canvas` → `--bg-surface` → `--bg-surface-raised`) is the primary way a
   card, panel, or modal reads as "above" what's behind it.
2. **Tinted shadow** for genuinely floating elements only (dropdowns, modals, the WhatsApp-reminder
   toast): `0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.04)` — the second layer is a
   1px inner highlight, not a shadow, simulating a light source instead of pure black falloff.

## Components (Operate-mode floor — every interactive component needs all of these)

Default, hover, focus, active, disabled, loading, error. Do not ship a component missing one of these —
the incumbent UI is missing active/pressed feedback on most buttons and has no visible focus ring
anywhere; both are fixed as part of this redesign, not optional polish.

- **Buttons**: one shape/radius vocabulary across the whole app. Primary = `--brand-500` fill, hover
  `--brand-400`, active/pressed a subtle `scale(0.98)` + `--brand-600`. Secondary = `--bg-surface-hover`
  fill with `--border-strong`. Destructive = Danger-tinted, reserved for genuinely destructive actions
  (disable member, delete), never for routine negative actions like "cancel."
- **Focus ring**: visible on every interactive element, `--brand-400` at 2px offset outline — not the
  browser default, not invisible (accessibility floor, not optional).
- **Loading**: skeleton loaders shaped like the content they replace, not a centered spinner over blank
  space. The incumbent's `LoaderCircle` + "جارٍ..." text pattern is replaced everywhere except tiny
  inline actions (e.g. a button's own in-progress state, where a small spinner inside the button is
  correct).
- **Empty states**: every empty state names what's missing and gives a direct call-to-action — never bare
  "لا توجد نتائج" with nothing else. The incumbent already does this in most places; keep and extend the
  pattern, give it visual weight (an icon + heading + action, not one line of gray text).
- **Overlays**: dropdowns/popovers (notification bell, profile menu) must not be clipped by an
  `overflow-hidden` ancestor — verify and fix if the redesign introduces any new scrollable containers.

## The signature screen: task pipeline view

Per Product Principle 1, this gets the most design attention in Phase 4 (dedicated subagent). It must
render as a **connected chain**, not a list of bordered boxes (the incumbent's current treatment):

- Steps connect with a visible line/rail (vertical, RTL-neutral — a vertical connector works identically
  in RTL and LTR, so no mirroring concern).
- Each step is a node on that rail: done = filled circle with a check, in `--brand-500`/Success; current =
  larger node, `--brand-400` ring with a subtle glow (the one place in the whole app where accent
  "decoration" beyond flat fill is earned, because this is the signature moment); pending = outlined,
  `--text-tertiary`.
- The current step's card is visually distinct from past/future steps (background at `--bg-surface-raised`
  vs. `--bg-surface` for the rest), so "where is this task right now" is answerable in under a second —
  the product's core promise, made literal.
- Per-step metadata (assignee, due date, WhatsApp reminder action) lives inside each step's own row, not
  in a separate section — the chain is the single source of truth for a task's state.

## Motion

150–250ms on all transitions (Operate-mode standard). Motion conveys **state only**: step completion
(the node fills, the connector segment animates), a task card's status changing, a new notification
arriving, send-back (the pipeline visibly retracts to the target step). No orchestrated page-load
sequences — this is a tool people open dozens of times a day; it must not perform an entrance animation
every time. Full decisions land in Phase 5 using the `animate`/`review-animations`/
`find-animation-opportunities` skills.

## RTL and i18n

- `dir="rtl"` stays at the document root (already correct).
- No icon gets horizontally mirrored except directional ones (arrows, chevrons that indicate "back/forward"
  in reading order) — checkmarks, the brand mark, and status icons stay as-is.
- Numbers and Latin-script content (emails, URLs) stay LTR-embedded inside RTL flow, exactly as the
  incumbent already handles them (`dir="ltr"` on those specific inputs/spans) — carry this forward.
- Long Arabic names/titles: `text-overflow: ellipsis` with a `title` attribute fallback, never silent
  truncation with no way to see the full value.

## Explicit anti-patterns (do not introduce, even locally)

Cream + serif + terracotta; near-black + single neon accent; broadsheet/hairline-rule editorial style;
decorative numbered markers; gradients or glassmorphism used without a state-communicating purpose; the
generic blue-and-white corporate SaaS look; the incumbent's `.glass-panel`/`.glass-card` utilities (remove,
do not port to dark mode); more than one accent color; pure black backgrounds; un-tinted `box-shadow`.

## Build checklist (carried from the ui-ux-pro-max cross-check, framework-agnostic parts only)

- No emoji as icons — Lucide only (kept from the incumbent; audited and confirmed fine for an internal
  tool, see `docs/v2/UI_REDESIGN_AUDIT.md`).
- `cursor-pointer` on every clickable element.
- Every interactive element has a hover transition (150–300ms).
- Focus states visible for keyboard navigation everywhere.
- `prefers-reduced-motion` respected.
- Text contrast on dark surfaces: `--text-primary` on `--bg-canvas`/`--bg-surface` must clear 4.5:1 (verify
  in Phase 6's audit pass).
