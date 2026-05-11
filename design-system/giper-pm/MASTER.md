# giper-pm — Design System (Master)

> **LOGIC:** When building a specific page, first check `design-system/giper-pm/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> Otherwise, strictly follow the rules below.

**Style family:** Data-Dense Dashboard (Material-derived, B2B-internal, WCAG AA).
**Why this style:** giper-pm is an internal PM/time-tracking tool for the giper.fm web-dev team. Users spend hours per day inside it scanning 20–200 tasks, deadlines, time entries, calendar grids. Information density matters more than visual delight. Animations are functional, not decorative.

---

## 1. Color Palette

We deliberately keep the palette **neutral-first** (Linear/Vercel-like) and reserve a single saturated accent for actions that must be noticed. No teal/blue/spa palette — those compete with task priority colors and project tags.

| Role | Light | Dark | When to use |
|---|---|---|---|
| **Primary surface** | `hsl(0 0% 100%)` white | `hsl(240 10% 3.9%)` near-black | Default page + card background |
| **Foreground** | `hsl(240 10% 3.9%)` | `hsl(0 0% 98%)` | Body text. Min 4.5:1 against background |
| **Muted surface** | `hsl(240 4.8% 95.9%)` | `hsl(240 3.7% 15.9%)` | Empty states, hover row, secondary chips |
| **Muted foreground** | `hsl(240 3.8% 46.1%)` | `hsl(240 5% 64.9%)` | Secondary text, timestamps, helper |
| **Border** | `hsl(240 5.9% 90%)` | `hsl(240 3.7% 15.9%)` | Card outlines, dividers, input borders |
| **Ring (focus)** | `hsl(240 5% 64.9%)` | `hsl(240 4.9% 83.9%)` | 2px focus ring, always visible |
| **Action / CTA accent** | `#D97706` amber-600 | `#F59E0B` amber-500 | Reserved for primary CTA (Create task, Save, Join meeting). One per screen. WCAG AA on white ≥ 4.5:1 |
| **Destructive** | `hsl(0 72.2% 50.6%)` | `hsl(0 62.8% 30.6%)` | Delete, leave meeting, irrecoverable actions |
| **Success** | `hsl(142 71% 35%)` | `hsl(142 71% 45%)` | DONE status, approved review, saved confirmation |
| **Warning** | `#D97706` amber-600 | `#F59E0B` amber-500 | OVER_BUDGET, REVIEW pending. Same as accent — context disambiguates |

### Task priority colors (semantic, do NOT change per page)

| Priority | Color |
|---|---|
| `LOW` | `hsl(240 3.8% 46.1%)` muted-foreground |
| `MEDIUM` | `hsl(240 10% 3.9%)` foreground (default — no color chip) |
| `HIGH` | `#D97706` amber-600 |
| `URGENT` | `hsl(0 72.2% 50.6%)` destructive |

### Task status colors (internal track)

| Status | Background | Text |
|---|---|---|
| `BACKLOG` | `hsl(240 4.8% 95.9%)` muted | muted-foreground |
| `TODO` | `hsl(217 91% 95%)` blue-50 | `hsl(217 91% 35%)` blue-700 |
| `IN_PROGRESS` | `hsl(38 92% 95%)` amber-50 | `hsl(38 92% 30%)` amber-800 |
| `REVIEW` | `hsl(280 80% 95%)` purple-50 | `hsl(280 60% 35%)` purple-700 |
| `BLOCKED` | `hsl(0 80% 95%)` red-50 | `hsl(0 72% 35%)` red-700 |
| `DONE` | `hsl(142 71% 95%)` green-50 | `hsl(142 71% 30%)` green-800 |
| `CANCELED` | `hsl(240 4.8% 95.9%)` muted | muted-foreground with line-through |

---

## 2. Typography

| Role | Font | Weights | When |
|---|---|---|---|
| **UI / body** | Plus Jakarta Sans | 400 / 500 / 600 | All headings, body, labels |
| **Tabular / data** | Fira Code (or system mono `ui-monospace`) | 400 / 500 | Task numbers (`GPM-142`), time entries, durations, money, prices, version tags, code blocks in comments |
| **Fallback** | system-ui | — | Pre-font load |

**Type scale** (matches Tailwind defaults; do not invent sizes):

| Token | Size | Line height | Where |
|---|---|---|---|
| `text-xs` | 12px | 16px | Chips, hints, captions. Never body text |
| `text-sm` | 14px | 20px | List rows, table cells, secondary labels |
| `text-base` | 16px | 24px | Body, descriptions, comment text |
| `text-lg` | 18px | 28px | Card titles, side-panel sub-headers |
| `text-xl` | 20px | 28px | Page sub-section h2 |
| `text-2xl` | 24px | 32px | Page title h1 |
| `text-3xl` | 30px | 36px | Empty-state hero, never list pages |

**Letter spacing:** default. Do not tighten body. `tracking-wide` only on uppercase eyebrow chips.

**Tabular numerals:** Apply `font-variant-numeric: tabular-nums` (Tailwind `tabular-nums`) on every `<td>` and chip that displays a number — keeps columns aligned across rows.

---

## 3. Spacing & Layout

**Rhythm:** 4px base. Use Tailwind `1` / `2` / `3` / `4` / `6` / `8` / `12` / `16` / `24` (= 4/8/12/16/24/32/48/64/96px). No arbitrary values.

| Token | Px | Use |
|---|---|---|
| `gap-1` | 4 | Tight icon+text |
| `gap-2` | 8 | Form field internals, chip rows |
| `gap-3` | 12 | List row internals |
| `gap-4` | 16 | Card padding, section gaps |
| `gap-6` | 24 | Major section separation |
| `gap-8` | 32 | Page-level vertical rhythm |

**Container widths:**

- Calendar / Dashboard / List: `max-w-[1400px]` — these are work surfaces, edge-to-edge data is fine on wide monitors but cap so on 32" displays it doesn't stretch unreadably.
- Settings / forms / detail pages: `max-w-3xl` (768px) — long-form reads.
- Modals: `max-w-md` for confirmations, `max-w-2xl` for editors.

**Breakpoints (Tailwind defaults):** sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536. Design mobile-first. Calendar month-view is desktop-only; on `< md` it collapses to agenda list (week grouped).

---

## 4. Elevation

Three levels, no more.

| Level | When | Tailwind |
|---|---|---|
| 0 — flat | List rows, inline cells | (no shadow) |
| 1 — surface | Cards, kanban columns | `shadow-sm` |
| 2 — popover | Dropdowns, popovers, toasts | `shadow-md` + `border` |
| 3 — modal | Dialogs, full-screen sheets | `shadow-lg` + backdrop scrim `bg-foreground/40` |

**Rules:**
- Never stack elevations (a card inside a card is flat).
- Modal scrim opacity 40% — readable underlying context, clear focus.

---

## 5. Radius

| Token | Px | Use |
|---|---|---|
| `rounded-sm` | 2 | Chips, badges |
| `rounded-md` | 6 | Buttons, inputs, dropdown items |
| `rounded-lg` | 8 | Cards, modals, list rows |
| `rounded-full` | — | Avatar circles only |

Do not mix `rounded-md` and `rounded-lg` within one component.

---

## 6. Motion

All transitions: `150ms ease-out` for state changes, `200ms ease-out` for entering, `120ms ease-in` for exiting. No springs in this product — it's an admin tool, not a consumer app.

| Use | Duration | Easing |
|---|---|---|
| Hover (color, opacity) | 120ms | ease-out |
| Button press | 80ms | ease-out |
| Modal enter | 200ms | ease-out (fade + scale 0.96 → 1) |
| Modal exit | 120ms | ease-in |
| Toast enter | 150ms | ease-out (slide-from-top + fade) |
| Filter / sort re-render | 150ms | ease-out (opacity only) |
| Skeleton shimmer | 1.2s | linear infinite |

Respect `prefers-reduced-motion`: animations replaced with instant opacity swap. Never animate width/height/top/left — use transform/opacity.

---

## 7. Interactive States

Every interactive element MUST visibly distinguish 4 states. No exceptions.

| State | Treatment |
|---|---|
| Default | Per-component baseline |
| Hover | +4% darken on muted bg OR `bg-muted` overlay; cursor-pointer |
| Active (pressed) | +6% darken; scale 0.98 for ≤200ms on tap |
| Focus-visible | 2px `ring-ring` + 2px offset, always visible for keyboard |
| Disabled | `opacity-50 cursor-not-allowed`, no hover effect |

**Touch targets:** ≥40px tall (admin tool on mouse; we relax from 44pt mobile baseline). On `< md` enforces 44px.

---

## 8. Icons

Icon set: **Lucide React** exclusively. No Heroicons mixing, no emojis as structural icons (✅ ❌ 📋), no Material Icons.

**Sizing tokens:**

| Token | Px | Use |
|---|---|---|
| `size-3.5` | 14 | Inline-with-text, chips |
| `size-4` | 16 | Buttons, list rows, dropdown items |
| `size-5` | 20 | Card headers, popover triggers |
| `size-6` | 24 | Page title bar, primary nav |

**Stroke:** Lucide default 2px. Never modify.

---

## 9. Data Display Rules (the soul of this product)

These rules override defaults because giper-pm is data-dense:

1. **Tables**: zebra rows OFF. Hover-highlight row `bg-muted/50`. Use border-bottom on rows, not borders on all sides.
2. **Numbers, durations, times, dates**: `tabular-nums` + Fira Code or `font-mono`. ALWAYS right-align in tables.
3. **Truncation**: every cell that could overflow gets `truncate` + `title` attribute for full text on hover. Multi-line clamp = `line-clamp-2`.
4. **Empty cells**: render `—` em-dash (`<span class="text-muted-foreground">—</span>`), not blank, not `null`, not `N/A`.
5. **Loading**: skeleton rows that match the final row geometry. Never spinners on lists.
6. **Sort indicators**: chevron up/down icon + `aria-sort` on `<th>`. Active sort column gets `text-foreground`, inactive `text-muted-foreground`.
7. **Filter chips**: dismissible (`x` icon), `rounded-full`, `bg-muted text-foreground`, small inline `text-xs`.
8. **Status badges**: from the table in §1 above. No new colors per page.
9. **Avatars**: 24px in list rows, 32px in detail headers. Group avatars: stack with `-ml-2` and `ring-2 ring-background`, max 3 visible + `+N` chip.
10. **Project keys / task numbers**: monospace, `text-muted-foreground`, e.g. `GPM-142`. Click goes to detail.

---

## 10. Accessibility (mandatory)

- All icon-only buttons have `aria-label`
- Focus ring visible on every interactive element
- Color is never the sole signaling channel — pair with icon/text (e.g. URGENT = red + icon, DONE = green + checkmark icon)
- Forms: label always visible above input; error message below in `text-destructive` with `aria-live="polite"` and inline icon
- Modal/sheet: `Escape` closes, focus trapped, focus returns to trigger on close
- Dynamic content (toast, async updates): `aria-live="polite"`

---

## 11. Anti-patterns (do NOT do)

- ❌ Saturated brand color used everywhere (creates noise on data-dense screens — accent is reserved)
- ❌ Multiple primary CTAs per screen
- ❌ Emoji icons in production UI
- ❌ Animations on filter/sort actions longer than 150ms (feels sluggish on data tables)
- ❌ Layout shift on hover (size/padding change). Use overlay/opacity instead
- ❌ Tooltips for critical info (must be visible without hover — tooltips are progressive enhancement)
- ❌ Status conveyed by color alone (always pair with text or icon)
- ❌ Custom select/dropdown without keyboard nav (arrow keys, Enter, Esc)
- ❌ Card-inside-card visual nesting (flatten or use list rows)
- ❌ Auto-refresh that loses scroll position (preserve scroll on revalidate)

---

## 12. References

- Tailwind config: `packages/ui/src/tokens.ts`
- shadcn/ui components: `packages/ui/src/`
- Lucide icons: https://lucide.dev/
- WCAG 2.1 AA: https://www.w3.org/WAI/WCAG21/quickref/
