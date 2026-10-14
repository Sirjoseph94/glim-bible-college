# GLIM LMS — Design System & UI/UX Overhaul Handoff

**Version:** 1.0 · **Date:** 10 Oct 2026 · **Audience:** Claude Code agents implementing a UI overhaul on the existing `apps/web` frontend (and humans reviewing their PRs)
**Companion documents:** `SCHOOL_LMS_BUILD_SPEC.md` v2.1 (product behaviour, API, data). This document **supersedes §17 (Frontend) of the build spec for everything visual and interactive**; the build spec still governs behaviour, data, API contracts and security.
**Design sources (private claude.ai artifacts; read with the Artifact tool's `read` action, never a web fetch):**
- Design system "GLIM LMS": `https://claude.ai/artifact/G7JicCjtZMetwPBiE47rCh` — tokens (`project/tokens.json`), brand book (`project/README.md`), reference components (`project/components/bundle.js`, `bundle.css`).
- Prototype canvas "GLIM LMS Prototype": `https://claude.ai/artifact/RHU2p12BCSz71mNve4xP1x` — 11 reference screens (`project/*.dc.html`).

> If this file and the artifacts disagree, **this file wins** for implementation and the disagreement is a bug to report. If the existing code contradicts this file, the existing code changes — unless doing so would break an invariant in §0.2, in which case stop and ask.

> **Repository note (added when this handoff was committed):** in this repository the build spec is `docs/TRD.md` v3.0 (v2.1 is archived at `docs/archive/TRD-v2.1.md`), and its frontend section is §18, not §17. Where this handoff and the TRD, `GLOSSARY.md` or `CLAUDE.md` disagree (e.g. "Teacher" vs Lecturer, "session" vs Class Meeting, the HLS player vs YouTube embeds), the conflicts are listed in `docs/ui-audit.md` § Questions and were resolved on 10 Oct 2026; the answers in `docs/decisions.md` (UI-Q1–UI-Q16) override this file where they differ.

---

## Table of contents
0. Rules of engagement
1. Overhaul goals and design principles
2. Phase 0 — audit the existing frontend (mandatory first step)
3. Implementation architecture of the design layer
4. Design tokens
5. Typography
6. Layout, spacing, breakpoints, shells
7. Iconography and imagery (logo rules)
8. Motion
9. Component specifications
10. Patterns (states, forms, offline, navigation, data display)
11. Screen specifications
12. Content and UX copy
13. Accessibility specification
14. Low-bandwidth performance budgets
15. Migration plan and work packages
16. Verification and Definition of Done
- Appendix A — `tokens.css` (verbatim)
- Appendix B — Tailwind preset and shadcn/ui variable mapping
- Appendix C — Contrast matrix
- Appendix D — Icon path data
- Appendix E — Old→new mapping worksheet template
- Appendix F — Open questions

---

## 0. Rules of engagement

### 0.1 Read order
1. §0–§3 (always). 2. §4–§8 before touching any style. 3. The component (§9) or screen (§11) your work package touches. 4. §13, §14, §16 before opening a PR.

### 0.2 Hard invariants (UI)
| # | Invariant |
|---|---|
| UI-1 | **Tokens only.** No raw hex, rgb, px font sizes, or ad-hoc shadows in feature code. Every colour, size, radius, shadow and spacing value comes from a token (CSS variable or the Tailwind preset that maps to it). Exceptions are listed explicitly in this file (the video stage, the logo chip, text on `glim-green`). A lint rule enforces this (§16.2). |
| UI-2 | **Both themes, always.** Every screen and component works in `light` and `dark`. Theme follows the OS (`prefers-color-scheme`) by default, with a user override stored per device. |
| UI-3 | **Status = word + colour (+ icon where space allows).** Colour is never the only signal. |
| UI-4 | **`live` red is reserved for a class happening now** (Live now badge, Join live button, live dot, live card ground). Nothing else uses it — not notifications, errors, or unread dots. |
| UI-5 | **Touch targets ≥ 44×44 px** (`tap-min`); primary buttons and inputs 48 px tall (`control-h`); inputs 16 px text (no iOS zoom). |
| UI-6 | **Low-bandwidth budgets are CI gates** (§14). A change that breaks a budget is not done. No web fonts. No images on first load except the 64 px crest. |
| UI-7 | **Never disable an action because the network dropped.** Queue it and say so (§10.4). |
| UI-8 | **Behaviour is unchanged unless this file says so.** The overhaul changes presentation, layout, copy and interaction details. API calls, routes, permissions and data flow stay as the build spec defines; if a screen needs data the API doesn't return, stop and raise it. |
| UI-9 | **Accessibility is WCAG 2.1 AA** (§13). Text contrast 4.5:1 (3:1 for ≥ 24 px or bold ≥ 19 px, and for borders, focus rings, meaningful icons). |
| UI-10 | **No AI-template tropes:** no gradient washes, no emoji, no coloured left-border cards, no decorative illustrations or stock photos, no filler stats. |

### 0.3 When to stop and ask
- The audit (§2) finds a screen, component or library that this file does not cover.
- A required change would alter an API call, route, permission check or stored data.
- A design token is missing for something you need (propose a token; never inline a value).
- An item in Appendix F affects your task.
- You are unsure how a library behaves: read its installed types/docs; never rely on memory.

### 0.4 Working agreements
- **Tokens and primitives first** (WP-UI-01..03) land before any screen work. Screens are migrated one route at a time behind no feature flag unless §15 says otherwise.
- **One PR per work package**, ≤ ~800 changed lines where feasible, with before/after screenshots at 390 px and 1280 px, light and dark.
- **No parallel styling systems at the end.** Old CSS, old theme files and unused component variants are deleted in the same WP that replaces them (§15.3).

---

## 1. Overhaul goals and design principles

### 1.1 Who we design for
| Persona | Device and context | What matters most |
|---|---|---|
| Student | Mid/low-end Android phone (2–4 GB RAM), mobile data (MTN/Airtel/Glo), frequently on 3G/weak 4G, pays per MB | Join today's class in one tap; rewatch recordings cheaply; submit work even when the signal drops; see results clearly |
| Teacher | Phone during class, laptop for grading | Start class fast; fix attendance in seconds; grade and finalize without mistakes |
| Registrar / admins | Laptop, office broadband | Dense, scannable tables; safe bulk actions with clear consequences |

### 1.2 Goals of the overhaul (measurable)
| Goal | Measure | Target |
|---|---|---|
| The next class is one tap away | Taps from app open to Meet opening for a live class | **1** (student), **1** (teacher) |
| Nothing wastes data | Initial JS (gzip/br) / first-load requests | ≤ 170 KB / ≤ 12 (§14) |
| Status is never ambiguous | Status shown with a word on every badge | 100 % |
| Usable on a 360 px phone | No horizontal page scroll at 360 px; all actions reachable | 100 % of routes |
| Accessible | axe violations (serious/critical) | 0 |
| Consistent | Raw colour/px values in feature code (lint) | 0 |

### 1.3 Principles (use these to decide anything this file does not cover)
1. **Now first.** Order every screen by urgency: what the person must act on now → what is next → reference material. A live class outranks a greeting; a due assignment outranks a course list.
2. **One primary action per view.** One `primary` (or `live`) button per screen region. Everything else is `secondary` or `quiet`.
3. **Cost is information.** Show data costs (MB/hour), time costs (minutes) and consequences ("Students will see this immediately") before the action, plainly, without alarm.
4. **Calm, scholarly, Nigerian.** Warm off-white grounds, the GLIM greens, generous line height, plain respectful English. Times in WAT, 24-hour.
5. **Flat and bordered.** Hairlines separate surfaces; shadows only for things that float.
6. **Phone first, desktop dense.** Design at 390 px, then add density at `bp-md` (640) and `bp-lg` (1024): multi-column cards, a left rail, real tables.
7. **Forgiving.** Drafts autosave; destructive actions confirm and explain; offline work queues.

---

## 2. Phase 0 — audit the existing frontend (mandatory first step)

No agent changes styles before the audit is merged as `docs/ui-audit.md`. The audit turns "an existing UI" into a concrete inventory so every later change is a mapped replacement, not a guess.

### 2.1 Procedure (WP-UI-00)
1. **Stack detection.** Record framework, router, styling approach (Tailwind version and config path, CSS modules, CSS-in-JS, plain CSS), component library (shadcn/ui, MUI, Chakra, custom), icon library, form library, theme mechanism, i18n, test tools. Read `package.json` and the config files; do not infer.
2. **Route inventory.** List every route with its file, the role(s) that reach it, and the screen in §11 it maps to (or `UNMAPPED`).
3. **Component inventory.** List every shared component (path, props, where used, count of usages). Map each to a §9 component, mark `KEEP+RESTYLE`, `REPLACE`, `DELETE` (unused), or `UNMAPPED`.
4. **Style inventory.** Run and attach the output of:
   - raw colours: `rg -n --glob '!**/node_modules/**' -e '#[0-9a-fA-F]{3,8}\b' -e 'rgba?\(' -e 'hsla?\(' apps/web/src`
   - raw sizes in classes/styles: `rg -n -e '\b\d+px\b' -e 'text-\[\d' -e 'p[xytrbl]?-\[\d' apps/web/src`
   - fonts loaded: `rg -n -e '@font-face' -e 'fonts.googleapis' -e 'next/font' apps/web`
   - Tailwind arbitrary values: `rg -n '\w-\[' apps/web/src`
5. **Budget baseline.** Build production and record initial JS/CSS sizes (gzip and brotli), route chunk sizes, number of requests to first screen, and Lighthouse mobile (slow 4G) LCP for `/login`, `/`, a course page and the player.
6. **Accessibility baseline.** Run axe (Playwright) on the same four routes; record violations by rule.
7. **Screenshots.** Capture each route at 390×844 and 1280×900, light and dark (if dark exists), into `docs/ui-audit/before/`.
8. **Fill Appendix E** (old→new mapping) and list everything `UNMAPPED` under "Questions" at the end of the audit. Stop for answers before WP-UI-04+ if any `UNMAPPED` item is user-facing.

### 2.2 Decision rules when mapping
| Situation | Do |
|---|---|
| Existing component matches a §9 component's job | Restyle it in place to the §9 spec; keep its file path and public props where possible; add the §9 props it lacks. |
| Existing component overlaps two §9 components | Split it; keep the old export as a thin wrapper until all call sites move, then delete it. |
| A third-party UI kit (MUI/Chakra/AntD) is in use | Do **not** theme it to look like this system. Replace with §9 components built on Radix primitives + Tailwind (budget and consistency). Plan its removal in §15. |
| shadcn/ui is in use | Keep it. Map its CSS variables to our tokens (Appendix B) and restyle each used shadcn component to §9. |
| A screen exists that §11 does not specify | Compose it from §9 components and §10 patterns following §1.3; list it in the PR as "composed, not specified". |
| Existing copy conflicts with §12 | Replace with §12 copy. Keep i18n keys stable if an i18n system exists; change values, not keys. |

---

## 3. Implementation architecture of the design layer

### 3.1 Target structure (adapt paths to the audit's findings)
```
apps/web/src/
  styles/
    tokens.css          # Appendix A verbatim — the ONLY place raw values live
    base.css            # resets, body, focus ring, reduced motion, selection, scrollbar
  design/
    tailwind-preset.ts  # Appendix B — maps Tailwind theme to CSS variables
    theme.ts            # ThemeProvider: light/dark/system, persisted per device (localStorage, try/catch)
    icons.tsx           # Icon component + 26 paths (Appendix D); no icon font
    cn.ts               # className merge helper (clsx + tailwind-merge if already present)
  components/ui/        # §9 primitives: Button, Badge, Banner, Field, Select, Checkbox, Radio, Switch, Tabs,
                        # Card, Sheet, Dialog, Menu, Skeleton, EmptyState, ProgressBar, Avatar, NotificationDot, Table
  components/app/       # §9 composites: AppShell, TopBar, BottomNav, NavRail, BackLink, SessionCard, CourseCard,
                        # VideoPlayer, QualityMenu, GpaSummary, ResultRow, AttendanceRow, ParticipantMatchCard,
                        # OfflineQueueIndicator, GradebookTable, CohortTable
```
- **Styling method:** Tailwind utility classes that resolve to token variables (Appendix B). Component variants via a typed variant helper (e.g. `class-variance-authority` if already installed; otherwise a small local `variants()` function — do not add a dependency for this alone).
- **Theme switching:** set `data-theme="light|dark"` on `<html>`. `tokens.css` defines `:root, [data-theme="light"]` and `[data-theme="dark"]`. The ThemeProvider resolves `system` via `matchMedia('(prefers-color-scheme: dark)')` and listens for changes. Store the choice under `glim.theme` (try/catch; fall back to `system`).
- **Primitives:** Radix UI for Dialog, Sheet (Dialog variant), DropdownMenu, Tabs, RadioGroup, Checkbox, Switch, Tooltip only where keyboard/ARIA behaviour is non-trivial. Plain elements elsewhere.
- **Reference implementation:** `bundle.js`/`bundle.css` in the design-system artifact are **reference React 18 components** (no build step, `sl-` classes). Port their structure, states and semantics; do not ship that bundle. Class names in the product use Tailwind, not `sl-`.

### 3.2 Rules for feature code
- Import UI only from `components/ui` and `components/app`. No direct Radix or third-party UI imports in routes.
- No `style={{…}}` with literal values except computed geometry (progress width %, virtualized offsets).
- Every new string goes through the i18n layer if one exists (§12).

---

## 4. Design tokens

All values below are exact copies of the design system's `tokens.json` (v1). `tokens.css` (Appendix A) exposes each as a CSS custom property `--<name>`. Use the **semantic name**, never the value.

### 4.1 Colour
Brand origin: the GLIM crest — green globe and Bible `#01a958`, torch flame `#ed3135`. Both are kept exact as identity tokens but **never** used for text, icons or control borders (logo green is only 3.08:1 against white). UI colours are derived from them.

| Token (`--name`) | Light | Dark | Usage |
|---|---|---|---|
| `surface` | `#f5f7f5` | `#101513` | Page background behind everything (a faint green-grey, after the logo). |
| `surface-raised` | `#ffffff` | `#171e1b` | Cards, sheets, the top bar, inputs. |
| `surface-sunken` | `#e9eeeb` | `#0b0f0d` | Wells: the video stage, table header rows, skeleton blocks. |
| `line` | `#d6dfda` | `#28322d` | Hairlines between rows and around cards. Decorative only; never the only cue for a control. |
| `line-strong` | `#7f8a84` | `#66736c` | Input and secondary-button borders, checkbox outlines (3:1 on surface and surface-raised). |
| `ink` | `#14201a` | `#ecf2ee` | Primary text on surface, surface-raised, surface-sunken, and on glim-green fills (5.4:1). |
| `ink-muted` | `#4f5d56` | `#a0aea7` | Secondary text, metadata, timestamps, on surface, surface-raised and surface-sunken. |
| `glim-green` | `#01a958` | `#01a958` | The logo green, exact (#01a958). Large identity fills only: the sign-in hero band, the cover, the course-card spine. Text on it is ink, never white (white is 3.1:1). Below 3:1 on surface, so never text, icons or control borders. |
| `glim-red` | `#ed3135` | `#ed3135` | The logo's torch flame, exact (#ed3135). Identity only: the flame mark beside the wordmark and the cover. For "live now" use live, which is the same red deepened to pass as text. |
| `brand` | `#00753d` | `#3fd08a` | GLIM green deepened for UI: primary buttons, active nav and tabs, links, progress fill. As text on surface, surface-raised and brand-soft. |
| `brand-strong` | `#005a2f` | `#7fe2b0` | Pressed primary button; brand text on brand-soft where more weight is needed. |
| `brand-soft` | `#dff3e8` | `#0f2e1f` | Selected rows, active nav pill, course-card header band. |
| `on-brand` | `#ffffff` | `#04170d` | Text and icons on a brand fill (the primary button label). |
| `live` | `#c8202a` | `#ff7a7d` | The torch flame as a signal: Live now badge, Join live button, live dot. Reserved for a class happening now. As text on surface-raised and live-soft. |
| `live-soft` | `#fde6e6` | `#3a1314` | Background of a session card that is live now. |
| `on-live` | `#ffffff` | `#1f0405` | Text and icons on a live fill (the Join live button). |
| `success` | `#0f6b85` | `#7cc9e0` | Present, Passed, Saved. Teal-blue, off the red–green axis; always with a word or icon. Text on surface-raised and success-soft. |
| `success-soft` | `#e0f1f6` | `#0e2b33` | Background behind success text and the Present badge. |
| `warning` | `#8a5a00` | `#efbe5d` | Partial attendance, Provisional results, link not ready yet. Text on surface-raised and warning-soft. |
| `warning-soft` | `#fcf1d8` | `#33270a` | Background behind warning text and banners. |
| `danger` | `#9b1c3a` | `#ff9bb1` | Absent, Failed, errors, destructive actions. A plum-crimson kept apart from live by hue and always paired with an icon and word. Text on surface-raised and danger-soft. |
| `danger-soft` | `#fbe5ea` | `#3a1420` | Background behind danger text and error banners. |
| `info` | `#2c55a0` | `#9dbcf2` | Neutral notices: Scheduled, Excused, "Recording starts when you join". Text on surface-raised and info-soft. |
| `info-soft` | `#e5ecf8` | `#162544` | Background behind info text and banners. |
| `focus` | `#2563c9` | `#8ab4f8` | Keyboard focus ring: 2px solid with a 2px offset so it always lands on the page surface (3:1+ on surface and surface-raised in both themes). |

**Colour usage rules**
- Page ground `surface`; cards, sheets, top bar, inputs `surface-raised`; wells (video stage chrome, table headers, skeletons) `surface-sunken`.
- Text `ink`; secondary text `ink-muted`. Never lighter than `ink-muted` for readable text.
- One `primary` (brand fill) action per region. Selected/active backgrounds `brand-soft` with `brand` text.
- `live` only for "happening now" (UI-4). A session card that is live uses `live-soft` ground and a `live` 1 px border.
- Status families: `success` = Present / Passed / Saved / Approved; `warning` = Partial / Provisional / Draft / due soon / not ready yet; `danger` = Absent / Failed / errors / destructive; `info` = Scheduled / Excused / neutral notices. Each pairs `-soft` ground + text colour.
- `glim-green` only for large identity fills (sign-in footer band, course-card spine where used). Text on it is **`#14201a` in both themes** (the light value of `ink`), never white — a documented exception to UI-1.
- Overlays/scrims: `rgba(11,15,13,0.45)` (documented exception), used only behind sheets and dialogs.

### 4.2 Spacing, radius, size, breakpoints, shadow

**Spacing**

| Token | Value | Usage |
|---|---|---|
| `space-1` | 4px | Icon-to-label gap, badge vertical padding. |
| `space-2` | 8px | Gap between related items in a row; badge horizontal padding. |
| `space-3` | 12px | Gap between list rows; dense card padding. |
| `space-4` | 16px | Card padding, phone page gutter. |
| `space-5` | 24px | Gap between sections on a phone; desktop gutter. |
| `space-6` | 32px | Gap between sections on desktop. |
| `space-8` | 48px | Page top padding on desktop; empty-state padding. |

**Radius**

| Token | Value | Usage |
|---|---|---|
| `radius-sm` | 6px | Inputs, badges, small buttons. |
| `radius-md` | 10px | Buttons, cards, banners. |
| `radius-lg` | 16px | Bottom sheets, the video stage, large cards. |
| `radius-pill` | 999px | Status badges, the live dot, segmented controls. |

**Size**

| Token | Value | Usage |
|---|---|---|
| `tap-min` | 44px | Minimum height and width of anything tappable. |
| `control-h` | 48px | Primary button and input height on phones. |
| `control-h-sm` | 36px | Compact buttons in tables and toolbars (desktop only). |
| `nav-h` | 64px | Mobile bottom navigation height (plus safe-area inset). |
| `content-max` | 1120px | Maximum content width on desktop. |

**Breakpoint**

| Token | Value | Usage |
|---|---|---|
| `bp-md` | 640px | Two-column cards; tabs stop scrolling. |
| `bp-lg` | 1024px | Bottom nav becomes a left rail; tables replace card lists. |

**Shadow**

| Token | Light | Dark | Usage |
|---|---|---|---|
| `shadow-sheet` | `0 -4px 16px rgba(24,32,28,0.10)` | `0 -4px 16px rgba(0,0,0,0.45)` | Bottom sheets and the mobile nav bar. |
| `shadow-pop` | `0 6px 20px rgba(24,32,28,0.14)` | `0 6px 20px rgba(0,0,0,0.5)` | Menus and the quality picker popover. |

**Z-index scale** (new; add to `tokens.css` §A as plain custom properties):
| Token | Value | Usage |
|---|---|---|
| `z-sticky` | 10 | Sticky table headers, sticky bottom action bars |
| `z-nav` | 20 | Bottom nav, top bar |
| `z-overlay` | 40 | Scrims |
| `z-sheet` | 50 | Bottom sheets, dialogs |
| `z-toast` | 60 | Offline indicator pill |

---

## 5. Typography

System fonts only — zero font downloads (UI-6). `--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif`; `--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace`. Remove any `@font-face`, Google Fonts link, or `next/font` usage found in the audit.

| Style | Family | Size / line | Weight | Tracking | Usage |
|---|---|---|---|---|---|
| `display` | sans | 28px / 34px | 700 | -0.01em | One per screen: the page greeting or page title. |
| `title` | sans | 22px / 28px | 650 | 0 | Screen titles below the top bar; sheet titles. |
| `heading` | sans | 18px / 24px | 600 | 0 | Section headings and card titles. |
| `body` | sans | 16px / 24px | 400 | 0 | Default text, inputs, buttons. |
| `body-sm` | sans | 14px / 20px | 400 | 0 | Card metadata, table cells, helper text. |
| `label` | sans | 14px / 20px | 600 | 0 | Field labels, tab labels, compact buttons. |
| `caption` | sans | 12px / 16px | 600 | 0.02em | Badges and overline labels; uppercase only inside badges. |
| `figure` | mono | 32px / 36px | 600 | 0 | GPA/CGPA and other headline numbers (tabular). |
| `code` | mono | 14px / 20px | 500 | 0 | Matric numbers, transcript serials, meeting codes. |

**Rules**
- One `display` per screen at most. On phone screens that contain a live or open class, the greeting drops to `title`-ish 20/28 bold and sits directly above the live card (Now first).
- Screen titles `title`; section headings `heading` (rendered as `h2`); card titles 17–18 px semibold (`heading`).
- Metadata `body-sm` in `ink-muted`. Never below 12 px; 12 px only in badges and nav labels.
- Codes (matric numbers, serials, verification codes, course codes) in `code`. GPA and other headline numbers in `figure` with `font-variant-numeric: tabular-nums`. Numeric table columns are tabular and right-aligned.
- Line length: body copy max 70ch on desktop.
- Sentence case everywhere except badge text inside `caption` (may stay sentence case — do not force uppercase except the GPA labels, which use 12 px uppercase `ink-muted`).
- Must render names with Yoruba/Igbo/Hausa diacritics (e.g. "Ọlọ́rùn", "Ụ̀kà") without fallback boxes on Android system fonts — include such a name in the Storybook/visual test fixtures.

---

## 6. Layout, spacing, breakpoints, shells

### 6.1 Breakpoints and grid
| Range | Name | Layout |
|---|---|---|
| < 640 px | phone | Single column, page gutter `space-4`, sections separated by `space-5`. **Bottom nav** visible. Primary actions full width at the bottom of cards/sheets. |
| 640–1023 px | tablet | Card grids `repeat(auto-fill, minmax(260px, 1fr))` with `space-4` gap. Still bottom nav. Gutter `clamp(16px, 3vw, 40px)`. |
| ≥ 1024 px | desktop | **Left nav rail** (88 px) replaces bottom nav. Content max width `content-max` (1120 px), centred. Dashboards use a two-column grid `minmax(0,1.5fr) minmax(0,1fr)` with `space-6` gap. Tables replace card lists. |
Design and test at **360, 390, 768, 1024, 1280, 1440** px. No horizontal page scroll at any width; wide tables scroll inside their own `overflow-x: auto` card.

### 6.2 App shells
**Phone shell** (height = viewport; the content area scrolls, the bars do not):
| Region | Spec |
|---|---|
| Top bar | 56 px, `surface-raised`, bottom `1px line`. Left: crest (28 px tall, on white chip — §7.3) + wordmark "GLIM LMS" 17/24 bold. Right: up to two icon buttons (44 px), e.g. Notifications with `NotificationDot` (brand). Detail pages replace crest+wordmark with `BackLink` (§9.10) and put the course code (mono, `brand`) on the right. |
| Content | Padding `16px 16px 24px`; vertical stack, gap `space-5` (24). Respect `env(safe-area-inset-*)`. |
| Sticky action bar (optional) | For a screen's single primary action (Submit assignment): `surface-raised`, top `1px line`, `shadow-sheet`, padding `12px 16px 20px`, z `z-nav`. |
| Bottom nav | `nav-h` 64 px + safe-area inset, `surface-raised`, top `1px line`, `shadow-sheet`. 4–5 items. |

**Desktop shell:** left `NavRail` (88 px, `surface-raised`, right `1px line`, crest at top, items stacked with `space-2`) + main column. Top header inside main column: page title block on the left (overline code/role 13–14 px, `title` 26/32 bold on desktop, meta line `body-sm` muted) and the page's actions on the right (wrap below title under 1024 px). Content area padding `32px clamp(16px,3vw,40px) 48px`.

### 6.3 Role navigation (bottom nav / rail items, in this order)
| Role | Items (icon) |
|---|---|
| Student | Home (`home`) · Courses (`book`) · Schedule (`calendar`) · Results (`award`) · Profile (`user`) |
| Teacher | Home (`home`) · Teaching (`book`) · Schedule (`calendar`) · Attendance (`users`) · Profile (`user`) |
| Registrar / admin | Home (`home`) · People (`users`) · Results (`award`) · Settings (`settings`) (+ Ops for institution admin, `alert`) |
A person with two roles (teacher who is also a student) gets a role switcher in Profile; the top bar shows "Teacher view" text (13/18 semibold `ink-muted`) when in the non-default role. Never a badge.

---

## 7. Iconography and imagery

### 7.1 Icons
- One in-house set of **26 stroke icons** on a 24 px grid, 1.75 stroke, round caps and joins, `currentColor`, shipped as inline SVG paths (Appendix D). No icon font, no sprite request, no icon CDN. If the audit finds `lucide-react` (or similar) already tree-shaken and under budget, you may keep it **only** for icons this set lacks, styled at 1.75 stroke.
- Sizes: 16 (inline with 13–14 px text, small buttons), 20 (default, buttons, list rows), 22 (nav), 30 (player play glyph).
- Icons never stand alone in nav or buttons — always a visible word — except icon buttons in top bars and rows, which have an `aria-label`.
- No emoji anywhere in the UI.

### 7.2 Imagery
None by default: no hero photos, stock images, illustrations or network avatars. People are shown as **initials avatars** (36 px circle, `surface-sunken` ground, `ink-muted` 13 px bold initials). Course identity = course code in mono on a `brand-soft` band.

### 7.3 Logo (GLIM crest)
- Source asset: `new-ncgc-logo-162.png` in the design system (500×515, full colour). Ship a resized **64 px PNG/WebP copy** (≤ 6 KB) for the app shell and the 500 px original only for transcripts.
- Always on a **white chip**: `background: #ffffff; border-radius: radius-sm (6px) [8px at 36px, 12px at 72px]; padding: 2px (28px) / 3px (36px) / 6px (72px)` — in both themes (documented exception to UI-1).
- Sizes: 28 px tall (phone top bar), 36 px (desktop rail), 72 px (sign-in, transcripts). Minimum 24 px. Clear space ≥ half the crest's width.
- Never recolour, redraw, crop, stretch, place on `glim-green`/`brand`/`live` fills, or use as a watermark in the app UI.
- Wordmark: the text "GLIM LMS" in the system sans (17/24 bold top bar; 28/34 bold sign-in), `ink`. There is no drawn wordmark.

---

## 8. Motion
Minimal and purposeful; everything honours `prefers-reduced-motion: reduce` (disable non-essential animation; keep instant state changes).
| Element | Trigger | Animation | Duration | Easing | Reduced motion |
|---|---|---|---|---|---|
| Button / row background | hover, press | background-color change | 120 ms | ease | instant |
| Live dot | live badge visible | opacity 1 → 0.35 → 1 | 1600 ms loop | ease-in-out | static dot |
| Bottom sheet | open / close | translateY(100% → 0) + scrim fade | 220 ms in / 180 ms out | cubic-bezier(0.2, 0, 0, 1) | fade only, 120 ms |
| Dialog | open / close | opacity + scale 0.98 → 1 | 160 ms | ease-out | fade only |
| Tabs indicator | tab change | none (instant underline swap) | — | — | — |
| Skeleton | loading | none (static `surface-sunken` blocks; no shimmer — saves battery and avoids motion) | — | — | — |
| Spinner | button `loading` only | rotate | 800 ms loop | linear | 2400 ms |
| Progress bar fill | value change | width | 200 ms | ease-out | instant |
| Offline pill | network change | slide down 8 px + fade | 160 ms | ease-out | fade |
No page-transition animations, no parallax, no animated illustrations.

---

## 9. Component specifications

Conventions: sizes are token names (values in §4); "focus" always means the global focus ring — `outline: 2px solid var(--focus); outline-offset: 2px` on `:focus-visible` — which every interactive element must show. Props are TypeScript; extend native element props where noted.

### 9.1 Button
**Use:** every action. One `primary` or `live` per region.
```ts
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'live' | 'danger'; // default 'secondary'
  size?: 'md' | 'sm';            // md = control-h (48); sm = control-h-sm (36) — desktop toolbars/tables only
  icon?: IconName;               // leading icon, 20 (md) / 16 (sm)
  loading?: boolean;             // keeps width, shows spinner instead of icon, sets aria-busy, blocks clicks
  block?: boolean;               // width 100% (default for primary actions in phone cards/sheets)
  asChild?: boolean;             // render as <a>/<Link> with identical styling (navigation buttons)
};
```
| Variant | Default | Hover | Pressed | Disabled |
|---|---|---|---|---|
| primary | `brand` bg, `on-brand` text | `brand-strong` bg | `brand-strong` bg | 55 % opacity, `cursor: not-allowed` |
| secondary | `surface-raised` bg, `ink` text, 1 px `line-strong` border | `surface-sunken` bg | `surface-sunken` | same rule |
| quiet | transparent, `brand` text | `brand-soft` bg | `brand-soft` | same rule |
| live | `live` bg, `on-live` text | `live` bg + 6 % black overlay | same | never disabled (hide instead) |
| danger | `surface-raised` bg, `danger` text + 1 px `danger` border | `danger-soft` bg | `danger-soft` | same rule |
Geometry: radius `radius-md`; padding-inline `space-5` (md) / `space-3` (sm); gap `space-2`; text 16/24 (md) or 14/20 (sm), weight 600; no text wrapping (truncate with ellipsis only in table cells).
**Rules:** labels are verbs (§12). A disabled button always has a visible reason within the same region, linked by `aria-describedby`. `loading` is for actions that take > 300 ms. Destructive actions (`danger`) open a confirmation Dialog (§9.11).

### 9.2 IconButton
44 × 44 hit area, 20 px icon, `ink-muted` (hover `surface-sunken` circle, radius `radius-pill`). Required `aria-label`. Optional `NotificationDot` positioned top-right (8 px `brand`, 2 px `surface-raised` ring).

### 9.3 Badge (status)
```ts
type BadgeProps = { status?: SessionState | AttendanceStatus | 'provisional'|'approved'|'failed'|'draft'; tone?: Tone; children: React.ReactNode };
type Tone = 'neutral'|'brand'|'live'|'success'|'warning'|'danger'|'info';
```
| Status | Tone | Word (exact) |
|---|---|---|
| scheduled | info | Scheduled |
| open | brand | Open to join |
| live | live (filled, pulsing dot) | Live now |
| ended | neutral | Ended |
| processing | warning | Recording processing |
| available | brand | Recording ready |
| cancelled | danger | Cancelled |
| present / partial / absent / excused | success / warning / danger / info | Present / Partial / Absent / Excused |
| provisional / approved / failed | warning / success / danger | Provisional / Approved / Failed |
| draft | warning | Draft |
Geometry: 12/16 semibold, letter-spacing 0.02em, padding `space-1` × 10 px, radius `radius-pill`, `-soft` ground + tone text (live: `live` ground, `on-live` text, 8 px pulsing dot). No icons inside badges. Never wraps (`white-space: nowrap`); if a row is narrow, the badge moves below the title rather than truncating.

### 9.4 Banner (inline message)
```ts
type BannerProps = { tone: 'info'|'success'|'warning'|'danger'|'offline'; title?: string; children?: React.ReactNode; action?: React.ReactNode; onDismiss?: () => void };
```
Layout: icon (20) + body (title 15/22 semibold in tone colour; text 14/20 `ink`) + optional action (Button `sm` `secondary`) + optional dismiss IconButton. Padding `space-3` × `space-4`, radius `radius-md`, `-soft` ground (offline: `surface-sunken` + 1 px `line`). Icons: info→`info`, success→`check`, warning/danger→`alert`, offline→`wifiOff`. Roles: danger `role="alert"`, others `role="status"`. Placement: above the content it concerns, never floating. Max one banner per region; stack at most two per screen.

### 9.5 Form controls
**TextField / TextArea**
```ts
type FieldProps = { label: string; hint?: string; error?: string; optional?: boolean; multiline?: boolean; rows?: number } & React.InputHTMLAttributes<HTMLInputElement>;
```
- Label always visible above (14/20 semibold `ink`; "(optional)" in `ink-muted` regular). Never placeholder-as-label.
- Input: height `control-h`, padding-inline `space-3`, radius `radius-sm`, 1 px `line-strong` border, `surface-raised` bg, 16 px text. TextArea min-height 120 px, padding `space-3`, vertical resize.
- States: hover border `ink-muted`; focus = focus ring; error = 2 px `danger` border + error text (14/20 `danger`, `alert` icon 16) replacing the hint, `aria-invalid`, `aria-describedby` → error id; disabled = `surface-sunken` bg, `ink-muted` text; read-only = no border, `surface-sunken` bg.
- Character counters ("412 words · aim for 500–700") live in the hint slot.
- Correct `type`, `inputMode`, `autoComplete` for every field (email, current-password, one-time-code, tel).
**Select:** native `<select>` styled like TextField with a 16 px chevron (no custom listbox on phones). **Checkbox / Radio:** 18 px controls with `accent-color: var(--brand)` inside a ≥ 44 px label row. **Switch:** only for instant-effect settings (Data saver, Theme); 44×24 track, `brand` when on, label to the left.
**Validation timing:** validate on blur and on submit; never on each keystroke for format errors. On submit with errors, focus the first invalid field and show a `danger` Banner summary at the top for forms with > 4 fields.

### 9.6 Card
`surface-raised`, 1 px `line`, radius `radius-md`, padding `space-4`. Interactive cards are a single `<a>`/`<Link>` (whole card tappable), hover `surface-sunken` border `line-strong`, focus ring on the card. Never nest interactive elements inside a fully-clickable card — if a card needs two actions, make the card non-clickable and use buttons. List cards (rows in a card) use 1 px `line` dividers, row padding 14 px × `space-4`, and are `overflow: hidden` to clip corners.

### 9.7 Tabs
Horizontal, scrolls sideways on phones (hidden scrollbar, edge fade not required), 1 px `line` bottom border, padding-inline `space-4`. Tab: min-height `tap-min`, 14/20 semibold, `ink-muted`; selected `brand` text + 3 px `brand` underline. Optional count pill (12/16, `surface-sunken`, `ink-muted`) only for things needing action. Radix Tabs semantics (`role=tablist/tab/tabpanel`, arrow-key navigation, roving tabindex). Selected tab is reflected in the URL (`?tab=recordings`) so back/refresh keep it.

### 9.8 BottomNav and NavRail
- **BottomNav** (phone/tablet): 4–5 equal items; each item 12/16 semibold label under a 22 px icon inside a 56×30 pill; selected item `brand` text with `brand-soft` pill; others `ink-muted`. `aria-current="page"` on the active item. Optional `NotificationDot` (brand) on the icon pill — never a number.
- **NavRail** (≥ 1024): same items stacked, 88 px wide, crest on a white chip at the top (36 px), `space-2` between items.
- Both are `<nav aria-label="Main">` containing links (`<a>`), not buttons.

### 9.9 TopBar
Phone: see §6.2. Desktop: no separate top bar — the rail plus the page header. Optional right-side items: Data saver Switch (students), Notifications IconButton, initials Avatar (36 px, `brand-soft` bg, `brand` initials) opening the profile menu.

### 9.10 BackLink
`chevronLeft` (20) + the parent's name ("Home", "Recordings", "Today"), 15/22 semibold `ink`, min-height `tap-min`, no underline, gap 2 px. Always a real link to the parent route (not `history.back()`), so deep links work. Never an unlabelled arrow.

### 9.11 Sheet and Dialog
- **Bottom sheet** (phones; becomes a centred Dialog ≥ 640 px): `surface-raised`, top radius `radius-lg`, `shadow-sheet`, drag handle 40×4 `line-strong` pill, padding `8px 16px 24px`, max-height 90vh with internal scroll, scrim `rgba(11,15,13,0.45)`. Primary action full width at the bottom. Close on scrim tap, Escape and the handle swipe-down (≥ 80 px). Focus trapped; returns focus to the opener.
- **Dialog** (confirmations): max-width 440 px, radius `radius-lg`, padding `space-5`; title `heading`; body states the consequence ("Students will see their course result immediately."); actions right-aligned (desktop) or stacked full width (phone): `quiet` Cancel + `primary`/`danger` confirm with a specific verb ("Finalize results", "Revoke transcript"). Destructive confirmations that cannot be undone require a reason field when the build spec says so (attendance override, revoke, reopen).

### 9.12 Skeleton and EmptyState
- **Skeleton:** static `surface-sunken` blocks matching the final layout (card outlines, 12–16 px text bars at 60–90 % width), radius `radius-sm`. No shimmer. Show only if data takes > 300 ms; never on cached data.
- **EmptyState:** centred in its region, padding `space-8`; 24 px icon in a 48 px `surface-sunken` circle, `heading` title, one `body-sm` sentence, at most one action. Copy in §12.4.

### 9.13 ProgressBar
Optional label row (label `body-sm` `ink-muted` left, rounded percentage 14/20 semibold `ink` tabular right), 6 px track `surface-sunken`, fill `brand`, radius pill. `role="progressbar"` with `aria-valuenow/min/max` and `aria-label`. Thin variant (4 px, no label) inside list rows.

### 9.14 SessionCard (the most important component)
```ts
type SessionCardProps = {
  state: 'scheduled'|'open'|'live'|'ended'|'processing'|'available'|'cancelled'; // composite display state, build spec §10.4
  role: 'student'|'teacher';
  courseCode: string; title: string; timeLabel: string; teacherLabel?: string; note?: string;
  opensAtLabel?: string;            // shown when state = scheduled
  onJoin?: () => Promise<void>;     // calls POST /sessions/:id/join (or /start for teachers)
  recordingHref?: string;           // for available
  dialIn?: { region: string; phone: string; pin: string }[];
};
```
Anatomy (top to bottom, gap `space-2`, padding `space-4`): row [Badge(state) · course code mono 13/20 `ink-muted` right-aligned] → title 18/24 semibold → meta `body-sm` `ink-muted` ("10:00 – 11:00 · Rev. Dr. Okafor") → optional note 14/20 `ink` → action (margin-top `space-2`) → for live student cards, "Weak signal? Dial in by phone" link (16 `phone` icon, 14/20 underlined, ≥ 44 px tall) opening a Sheet with numbers and PIN.
| State | Ground | Action |
|---|---|---|
| scheduled | card | No button. `clock` + "Opens 13:45 (in 3 h 20 min)" 14/20 semibold `info`. |
| open | card | `primary` block "Join class" (teacher: "Start class"). |
| live | `live-soft`, 1 px `live` border | `live` block "Join live class" (teacher: "Start class"). |
| ended | card | None; meta adds "Recording expected" if recording on, until `recording` says processing or ready (ui-overhaul #01). |
| processing | card | None; "Recording processing · about 15 min". |
| available | card | `secondary` block "Watch recording". |
| cancelled | card | Title struck through `ink-muted`; reason line; no action. |
**Join interaction:** tap → button `loading` → success opens `joinUrl` in a new tab/app (`window.open`, `noopener`) and shows "Opening Google Meet…" inline for 3 s; errors map to copy in §12.3 (`GOOGLE_ACCOUNT_REQUIRED` opens the link-account Sheet; `PROVIDER_NOT_READY` shows `warning` inline text with retry countdown from `Retry-After`; `JOIN_WINDOW_CLOSED` updates the card to the correct state). Never render the Meet URL as text.
**Polling:** while a SessionCard for today is on screen and the tab is visible, refetch session state every 30 s with ETag; stop when hidden (§14).

### 9.15 CourseCard
Whole card is a link to the course. Band: `brand-soft`, padding `space-3` × `space-4`, course code mono 14/20 semibold `brand` left, next-session Badge right. Body padding `space-4`, gap `space-3`: title 18/24 semibold (2-line clamp), teachers `body-sm` `ink-muted` (1 line, ellipsis), ProgressBar "Recordings watched".

### 9.16 VideoPlayer and QualityMenu
- **Stage:** 16:9, background `#0b0f0d` in both themes (documented exception: video is always on black), radius 0 on phones (full-bleed), `radius-lg` on desktop. Controls in `#ecf2ee` over translucent white chips (`rgba(255,255,255,0.14–0.22)`); scrubber fill uses dark-theme `brand` `#3fd08a`.
- Controls: centre Play/Pause (64 px circle), bottom scrubber (4 px track; 44 px tall hit area), time "24:10 / 58:02" tabular 12/16, Quality chip button (≥ 44 px tall) showing current mode ("Auto · 240p", "Audio only · ≈ 18 MB/h"), captions toggle when captions exist, fullscreen.
- **Below the stage:** title `title`, meta `body-sm`, a row of `sm` buttons: "Audio only" (toggles to "Back to video"), lecture notes download with size ("Lecture notes (PDF, 310 KB)"), resume Banner (`info`) when resuming.
- **QualityMenu** (inside a bottom Sheet on phones, a popover menu ≥ 640 px): radio list — "Auto (saves data) · Starts at 240p, adapts to your network", "Audio only · ≈ 18 MB per hour" (headphones icon), 240p ≈ 95, 360p ≈ 170, 480p ≈ 280, 720p ≈ 480 MB per hour (only rungs that exist for the asset). Selected row `brand-soft`. Footnote: "On mobile data Auto stays at 480p or below unless you choose more." Choice persists per device.
- Behaviour per build spec §12.7 (start rung, Save-Data, token refresh, progress checkpoints every 15 s). Data saver ON ⇒ default Audio only.

### 9.17 GpaSummary and ResultRow
- **GpaSummary** card: two cells (label 12/16 uppercase semibold `ink-muted`; value `figure` 32/36 mono tabular) — "This semester" GPA and "CGPA"; footer row (top 1 px `line`): class label 14/20 semibold ("Second Class Upper"), Badge `Provisional` (warning) or `Approved` (success), credits earned `body-sm` `ink-muted` right-aligned. Values always two decimals ("4.20"). Before any finalized result: "—" with "No results yet".
- **ResultRow:** left — "BTH 301 · 3 credits" mono 13/18 `ink-muted`, title 15/22 semibold, note 13/18 `ink-muted` ("Finalized Mon 12 Oct", "Repeat · your best attempt counts", "Your teacher has not finalized yet"); right — letter in mono 22/28 semibold and percentage 13/18 tabular `ink-muted`. Pending: letter "—", "Awaiting".

### 9.18 AttendanceRow and ParticipantMatchCard (teacher)
- **AttendanceRow:** initials avatar 36 → name 15/22 semibold + meta 13/18 `ink-muted` ("31 min · joined late · 3 joins") → Badge(status) → "Edited" 12/16 `ink-muted` if overridden → IconButton chevron (`aria-label="Change attendance for {name}"`) opening the override Sheet (status radio + required reason, min 5 chars).
- **ParticipantMatchCard:** card with 1 px `warning` border; header `alert` icon + "2 people could not be matched" (15/22 semibold `warning`) + explanation 14/20 `ink`; inner well (`surface-sunken`, radius `radius-md`, padding `space-3`): participant label ("“Tunde B.” · in class 41 min") + suggestion ("Possible match: Tunde Bakare (same name, no other evidence)"); actions side by side: `primary` "Confirm match", `secondary` "Not this student"; footer "Next: …" 13/18 `ink-muted`. After confirm: success Banner with the recalculated status and the summary badges update (counts must stay consistent: total students = Present + Partial + Absent + Excused).

### 9.19 DataTable (gradebook, cohorts, broadsheets)
Inside a Card with `overflow-x: auto`; `<table>` with `<caption>` (visually hidden if a heading names it), `<th scope="col">`. Header cells `surface-sunken`, 13/18 semibold `ink-muted`, may wrap to two lines ("Quiz 1 / 20 · 10%"). Body cells 14/20, padding 12 × 14, 1 px `line` row dividers, `white-space: nowrap`. Numeric columns right-aligned, tabular. First column (person/cohort) sticky-left on horizontal scroll (`position: sticky; left: 0; background: surface-raised; z: z-sticky`). Row hover `surface-sunken` (desktop only). Editable cells (gradebook): click/Enter to edit inline, 16 px input, Enter/Tab saves and moves right/down, Escape cancels; saving shows a 16 px `check` in `success` for 1 s; validation errors inline in `danger`. Min table width set so columns never squash (e.g. 820 px gradebook, 640 px cohorts). Pagination via "Show more" (cursor) below the table, never page numbers.

### 9.20 OfflineQueueIndicator
When `navigator.onLine` is false or requests fail with network errors: an `offline` Banner at the top of the current screen ("You are offline · Your work is saved on this phone and will send when you reconnect."). Queued actions show a pill (`surface-sunken`, `ink`, 13/18, `clock` icon) in the screen's sticky action bar: "1 submission waiting to send". On reconnect: send, then a `success` Banner for 4 s ("Sent. Your assignment was submitted at 21:14."). Implementation: IndexedDB-backed queue keyed by the API's Idempotency-Key so replays are safe.

### 9.21 Small parts
- **NotificationDot:** 8 px, `brand`, 2 px `surface-raised` ring. Means "something new" — never a count, never `live`.
- **Avatar (initials):** 36 px circle; student/teacher lists `surface-sunken`/`ink-muted`; current user `brand-soft`/`brand`.
- **Divider with label** ("or use your email"): two 1 px `line` rules with 14/20 `ink-muted` text between, gap `space-3`.
- **Data saver Switch:** label "Data saver", helper text "Starts every video as audio only."

---

## 10. Patterns

### 10.1 Screen states (every data-driven region implements all five)
| State | Presentation |
|---|---|
| Loading (> 300 ms) | Skeleton matching the final layout. Keep previous data visible while refetching (stale-while-revalidate). |
| Empty | EmptyState with §12.4 copy and at most one action. |
| Error (recoverable) | `danger` Banner in the region: what happened + "Try again" (`sm` secondary). Keep any cached data visible below it. |
| Offline | `offline` Banner (§9.20); cached data stays; actions queue. |
| Partial / provider issue | `warning` Banner, e.g. "Google Meet is unavailable. Classes already in progress are not affected." (LIVE-008). |
| Permission denied / not found | Full-region EmptyState: "This page isn't available to you" + "Go to Home". Never reveal whether the resource exists. |

### 10.2 Navigation
- Phone: bottom nav for top-level sections; detail pages push with a BackLink in the top bar; course sections are Tabs; secondary flows (quality, dial-in, override, confirm) are bottom Sheets.
- Desktop: rail + page header; Tabs in the header for course/teaching sections; Sheets become Dialogs.
- Deep links always work (tab state in the URL; BackLink targets the parent route).
- Scroll position is restored when returning to a list.

### 10.3 Forms
Single column at all widths (max 560 px on desktop). Primary action at the bottom (phone: sticky action bar for long forms). Autosave drafts every 5–10 s after the last keystroke and on `visibilitychange`, with a status line ("Draft saved on this phone 2 min ago"). Never clear a form on error.

### 10.4 Offline and slow network
- Reads: show cached data with "Updated 10 min ago" in `body-sm` `ink-muted` when stale.
- Writes: assignment submissions, quiz answers, attendance overrides and grade edits are **queued** (§9.20) with the request's Idempotency-Key. The action button stays enabled and its label stays the same ("Submit assignment"); the status line explains that it will send on reconnect.
- Never block the UI on a spinner for > 1 s without explaining what is happening.
- Uploads > 8 MB use resumable multipart (build spec §13.1) with a ProgressBar and "Pause"/"Resume".

### 10.5 Destructive and high-consequence actions
Finalize results, approve and publish, revoke transcript, cancel session, attendance override, delete recording → Dialog stating the consequence and who is affected, specific confirm verb, required reason where the build spec requires one. After success: `success` Banner with an Undo link when the backend supports undo (e.g. recording delete within 7 days).

### 10.6 Data display
- Phone: lists of cards/rows; desktop: DataTable for ≥ 4 comparable attributes.
- Dates "Tue 13 Oct", times "10:00 – 11:00" (en dash, spaces), relative only within 24 h ("in 3 h 20 min", "2 min ago"). WAT always; show "WAT" only on desktop schedules or when the viewer's device timezone differs.
- Numbers: GPA two decimals; percentages integers unless < 1 %; file sizes "310 KB", "1.2 MB"; data costs "≈ 95 MB per hour".
- Long text: titles clamp to 2 lines, names and teacher lists to 1 line with ellipsis and the full value in `title` attribute and accessible name.

---

## 11. Screen specifications

Reference designs: the prototype canvas artboards named in each heading. Phone frames are 390×844; desktop pages are fluid (designed at 1280). Routes are the build spec's §17.2 routes; keep existing route paths if they differ (record the mapping in the audit).

### 11.1 Sign in — `/login` (artboard `Main.dc.html`)
- **Order:** crest (72 px on white chip) → "GLIM LMS" 28/34 bold → subtitle "Live classes, recordings and results in one place." → **`primary` "Continue with Google"** (block) → divider "or use your email" → Email field → Password field → `secondary` "Sign in with email" (block) → `quiet` "Forgot password?" → footer band `glim-green` with globe-line glyph and `#14201a` text: "Students: sign in with the Gmail account you gave the school. You need it to join live classes."
- **Why Google first:** students must link Google for live classes (build spec §8.1); email is the fallback.
- **States:** loading on the pressed button only; errors (`INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`) as a `danger` Banner above the email field (uniform wording, no account enumeration). Invite flow `/invite/:token` reuses this layout with "Set your password" or "Continue with Google".
- **Desktop:** centred column max 400 px on `surface`; footer band becomes a card below the form.

### 11.2 Student Today — `/` (artboards `Home.dc.html`, `DeskStudent.dc.html`)
- **Phone order (Now first):** greeting 20/28 bold + date line (`body-sm`, e.g. "Tuesday, 13 October · your class has started") → **Happening now** (SessionCard live/open) → Later today (SessionCards) → Continue watching (one card: course code, title, ProgressBar "Resume at 24:10", links to player) → Due this week (row cards with Badge Draft/Not started) → bottom nav.
- With no live/open class: greeting may use `display` 28/34; sections: Next class → Continue watching → Due this week → My courses (CourseCards).
- Banners at the very top when relevant: `warning` "Link your Google account · You need it to join live classes." with action "Link" (if no Google identity); `info` results-published notice for 24 h after publication.
- **Desktop:** two-column grid: left = Today (SessionCards in a card grid) + My courses (CourseCard grid); right = Continue watching, Results (GpaSummary link), Due this week. Top-right: Data saver Switch, Notifications, Avatar.
- **Empty:** no classes today → EmptyState "No classes today" + "See your week".

### 11.3 Course — `/courses/:offeringId?tab=` (artboard `Course.dc.html`)
- Header (`surface-raised`): BackLink "Home" + course code right → title `title` (22/28) → teachers + credits `body-sm` → Tabs: Overview, Live, Recordings (count), Work (count of to-do), Grades, Materials.
- **Recordings tab:** meta line "12 recordings · available until 30 Jun 2027" + Data saver Switch → list card of rows: 44 px icon tile (`play`/`clock`/`check`) → title 15/22 semibold, meta "Mon 12 Oct · 58 min · ≈ 92 MB at 240p", thin ProgressBar if partially watched → Badge (Ready / Processing / Watched). Processing rows are not links. Footnote on Data saver.
- **Live tab:** upcoming SessionCards; past sessions as rows with attendance status badge (student's own).
- **Work tab:** assignments and quizzes rows with due date, status Badge, score when released.
- **Grades tab:** released grades only (ResultRow style per assessment) + course result when finalized.
- **Materials tab:** file/link rows with size and type; downloads via the authenticated download route.
- After the 180-day window the Recordings tab shows EmptyState "Recordings for this course have been removed" with the date.

### 11.4 Player — `/watch/:vodId` (artboard `Watch.dc.html`)
- BackLink "Recordings" + course code → VideoPlayer (§9.16) → title, meta → actions row (Audio only, Lecture notes) → resume Banner → description/transcript (if any).
- Quality chip opens QualityMenu Sheet. Data saver ON ⇒ starts in Audio only with Banner "Playing audio only to save data · Switch to video".
- Errors: token expired → silent refresh and continue; playback failure → `danger` Banner "This recording didn't load · Try a lower quality or audio only" with buttons.

### 11.5 Assignment — `/courses/:id/work/:assignmentId` (artboard `Assignment.dc.html`)
- BackLink → offline Banner when offline → title `title` + due Badge (warning when ≤ 72 h, danger when overdue) + "20 marks · 1 attempt" → instructions (body, max 70ch) → answer TextArea with word-count hint → attachment rows (name, size, status "waiting to upload"/"uploaded", remove IconButton) → `secondary` "Attach a file (up to 50 MB)" → sticky action bar: draft status line + **enabled** `primary` "Submit assignment" (`upload` icon).
- After submit: success state replaces the form ("Submitted Tue 13 Oct, 21:14 · Attempt 1 of 1") with the submitted text read-only and "Resubmit" (if attempts remain and before cutoff).
- Late: Banner `warning` "Submitting late · Your teacher may deduct marks." before confirm.

### 11.6 Results — `/results` (artboard `Results.dc.html`)
- Top bar title "Results" + matric number (mono, right) → GpaSummary → `info` Banner explaining Provisional when applicable → "This semester" list card of ResultRows → earlier semesters as collapsible sections (semester GPA in the header) → Transcripts card: explanation line, `secondary` "Unofficial transcript (PDF, ≈ 120 KB)", `quiet` "Request official transcript" (opens Sheet form: purpose, recipient name/email).

### 11.7 Teacher Today — `/teach` (artboard `TeacherHome.dc.html`)
- Greeting (20/28) → class open/live SessionCard (role teacher, "Start class", note "18 students are in the Meet lobby") → `info` Banner "Recording starts when you join · You join as co-host, so you can admit, mute and present." → **Needs your attention** rows (icon tile in tone colour → title → meta → chevron): "Review attendance — 2 people not matched", "Grade 7 reflection papers — then finalize results", "Recording failed — retry" (danger tone) → Coming up SessionCards.
- Teacher without Google account: `warning` Banner "Link your Google account so you can co-host your classes."

### 11.8 Attendance review — `/teach/sessions/:id/attendance` (artboard `Attendance.dc.html`)
- BackLink "Today" + course code → title "Attendance" + "Kings of Judah, part 2 · Mon 12 Oct · class ran 58 min" → summary badges "21 Present · 3 Partial · 2 Absent · 1 Excused" (counts always sum to enrolled) → ParticipantMatchCard (if unresolved) → Students list card of AttendanceRows (sorted: Absent, Partial, Present, Excused; then name) → explanation "Present means in class for at least 75% of the time it ran. Tap a student to change their status; a reason is required." (thresholds from the session's policy snapshot, not hard-coded).
- Desktop: two columns — left list/table, right ParticipantMatchCard + session facts + CSV export.

### 11.9 Gradebook — `/teach/:offeringId?tab=gradebook` (artboard `DeskGradebook.dc.html`)
- Header: code + section (mono `brand`), title, "26 students · you are the primary teacher"; actions: `secondary` "Import scores (CSV)", `secondary` "Release {assessment} grades", `primary` "Finalize results" (disabled with reason "Finalize unlocks once the exam is graded." under the buttons) → Tabs.
- `info` Banner: "Running totals cover graded work only (60% of the course)…"
- DataTable: Student (name + matric, sticky) · one column per assessment ("Quiz 1 / 20 · 10%"), ungraded cells show Badge "To grade" (warning) · "Not held" for future assessments in `ink-muted` · Running total (semibold) · Attendance %. Editable cells per §9.19. Footer: "Showing 8 of 26 students… Every change is logged with your name and the time."
- **Phone:** the table stays a table inside its horizontal scroll card (sticky first column); header actions stack full width; Finalize sits last.

### 11.10 Registrar semester results — `/registrar/results` (artboard `DeskRegistrar.dc.html`)
- Header: overline "Registrar", title "Semester results", meta "2025/26 · Second semester · grading scheme NUC 5-point, best attempt counts"; action `secondary` "Broadsheet (CSV)".
- `warning` Banner with the live count ("3 cohorts are ready to approve") and the consequence sentence.
- Desktop split (2fr / 1fr): Cohorts DataTable (Programme · level, Students, Courses finalized "8 of 8", Status Badge: Ready to approve (brand) / Provisional (warning) / Approved (success), Action: `primary sm` "Approve and publish" or the blocking reason "Waiting on GRK 301") + Transcript requests list card (name, Badge Official/Issued, purpose or serial + verify code mono, actions Issue/Reject or PDF/Revoke).
- Approve opens a Dialog: "Approve B.Th · Year 1? 48 students' GPA and CGPA become official and official transcripts can include this semester." → "Approve and publish".

### 11.11 Screens composed from patterns (no artboard yet — build from §9/§10)
Schedule (week list grouped by day with SessionCards; desktop week grid), Profile (link Google account, notification preferences, theme, data saver, sign out), Transcript verify `/verify/:code` (public; crest, verification status Badge, minimal fields, hash comparison input), Quiz attempt (one question per screen on phones, sticky timer bar with `warning` under 2 min, autosave status), Teacher schedule/session create (form §10.3; conflict errors inline), Admin academic setup and imports (DataTables + Sheets), Ops failures (DataTable with replay). Each is listed as "composed, not specified" in its PR with screenshots for review.

---

## 12. Content and UX copy

### 12.1 Voice
Warm, plain, respectful — the school speaking to a student. "You", never "the user". No slang, no exclamation marks, no emoji, no blame ("You entered" → "This"). Say the action, then the reason. British/Nigerian English spelling ("enrol" in prose is acceptable but keep UI labels consistent with existing keys: use "Enroll" only if the audit shows it is established).

### 12.2 Fixed vocabulary (use exactly these words)
| Concept | Word |
|---|---|
| Session states | Scheduled · Open to join · Live now · Ended · Recording processing · Recording ready · Cancelled |
| Attendance | Present · Partial · Absent · Excused · Edited (override marker) |
| Results | Provisional · Approved · Finalized · Awaiting |
| Primary verbs | Join live class · Join class · Start class · Watch recording · Audio only · Back to video · Submit assignment · Attach a file · Finalize results · Release grades · Approve and publish · Issue transcript · Revoke · Confirm match · Not this student · Link Google account · Try again |
| Data | "≈ 95 MB per hour", "Data saver", "Saved on this phone" |

### 12.3 Error and system messages (API code → title · body · action)
| Code | Title | Body | Action |
|---|---|---|---|
| `GOOGLE_ACCOUNT_REQUIRED` | Link your Google account | You need it to join live classes. Use the Gmail account you gave the school. | Link Google account |
| `PROVIDER_NOT_READY` | The class link is being prepared | Try again in {n} seconds. | Try again (auto-retries) |
| `PROVIDER_UNAVAILABLE` | Google Meet is unavailable | Classes already in progress are not affected. We'll keep trying. | — |
| `JOIN_WINDOW_CLOSED` | This class isn't open | It opens at {time}. / It ended at {time}. | Watch recording (if available) |
| `OFFERING_FULL` | This class is full | Ask the academic office about another section. | — |
| `INVALID_CREDENTIALS` | That email and password don't match | Check them and try again, or continue with Google. | — |
| `ACCOUNT_LOCKED` | Too many attempts | Try again in 15 minutes, or reset your password. | Reset password |
| `RATE_LIMITED` | Slow down a little | Try again in a moment. | — |
| `VERSION_MISMATCH` | Someone else changed this | We've loaded the latest version. Check it and save again. | Reload |
| `WEIGHTS_NOT_100` | Weights must add up to 100% | They add up to {n}% now. | Edit weights |
| `RESULT_LOCKED` | Results are finalized | Ask an academic admin to reopen them if something is wrong. | — |
| Network failure | You are offline | Your work is saved on this phone and will send when you reconnect. | — |
| Unknown 5xx | Something went wrong on our side | Try again. If it keeps happening, quote reference {requestId}. | Try again |

### 12.4 Empty states
| Where | Title | Body | Action |
|---|---|---|---|
| Today (student) | No classes today | Your next class is {day, time}. | See your week |
| Recordings | No recordings yet | Recordings appear here about 15 minutes after a class ends. | — |
| Recordings (purged) | Recordings for this course have been removed | They were available until {date}. | — |
| Work | Nothing due | Your teacher hasn't set any work yet. | — |
| Results | No results yet | Results appear here as soon as your teachers finalize them. | — |
| Attendance (teacher) | No attendance yet | Attendance appears about 10 minutes after the class ends. | — |
| Search | No matches | Try a course code like "BTH 201". | Clear search |

### 12.5 Length and truncation
Course titles ≤ 60 chars displayed (2-line clamp); session titles 2-line clamp; names 1 line in rows; button labels ≤ 24 chars; Banner titles ≤ 50 chars, bodies ≤ 140 chars. Test every screen with a 30 % longer string fixture.

---

## 13. Accessibility specification (WCAG 2.1 AA)
- **Contrast:** all pairs in Appendix C pass in both themes. New pairs must be checked with the same script before merging.
- **Focus:** visible focus ring on every interactive element (2 px `focus`, 2 px offset). Focus order follows visual order; sticky action bars come last in tab order on their screen. Sheets/Dialogs trap focus and restore it on close.
- **Semantics:** one `<h1>` per screen; sections use `<h2>`; nav is `<nav aria-label="Main">` with `aria-current="page"`; status changes announced via `role="status"` (polite) and errors via `role="alert"`; tables have `<caption>` and `scope`; icon-only buttons have `aria-label`; decorative SVGs `aria-hidden="true"`; the crest has `alt="GLIM crest"`.
- **Live regions:** session state changes on Today ("Your class is live now"), queued-action sent confirmations, and gradebook save confirmations are announced politely; the countdown is not announced.
- **Touch:** ≥ 44×44 px targets with ≥ 8 px spacing between adjacent targets in lists.
- **Zoom & reflow:** usable at 200 % text zoom and 320 px CSS width without loss of content; no fixed heights on text containers.
- **Motion:** `prefers-reduced-motion` honoured (§8).
- **Media:** captions toggle when captions exist; player controls keyboard-operable (Space/K play-pause, ←/→ 10 s, M mute, F fullscreen) and labelled.
- **Forms:** labels bound with `for`/`id`; errors linked by `aria-describedby`; required fields marked in the label text, not colour.
- **Language:** `<html lang="en">`; names with diacritics render correctly.

---

## 14. Low-bandwidth performance budgets (CI gates)
| Budget | Limit | Tool |
|---|---|---|
| Initial JS (login + shell), brotli | ≤ 170 KB (fail > 200 KB) | `size-limit` or bundle analyzer in CI |
| Any route chunk | ≤ 60 KB; player route ≤ 40 KB excl. `hls.js` (lazy) | same |
| Initial CSS | ≤ 30 KB | same |
| Requests to first interactive screen | ≤ 12 | Playwright request count |
| LCP, Lighthouse mobile (slow 4G, 4× CPU) | ≤ 4.0 s on `/login`, `/`, course, player | Lighthouse CI |
| Fonts downloaded | 0 | Playwright request filter |
| Images on first load | crest 64 px only (≤ 6 KB) | Playwright |
| API list payloads | ≤ 50 KB uncompressed per request; ETag on lists | contract tests |
Practices: route-level code splitting; lazy-load `hls.js`, PDF viewers, charts and admin-only code; no polling on hidden tabs; ETag/304 for polls; `Cache-Control: immutable` on hashed assets; precache only the app shell in the service worker; no analytics/trackers; Data saver disables non-essential images and prefetch.

---

## 15. Migration plan and work packages

### 15.1 Sequence
| WP | Name | Depends | Output / acceptance |
|---|---|---|---|
| WP-UI-00 | Audit | — | `docs/ui-audit.md` + Appendix E filled + baselines (§2). Merged before any style change. |
| WP-UI-01 | Tokens & base | 00 | `tokens.css` (Appendix A + z-index), `base.css`, Tailwind preset (Appendix B), ThemeProvider, shadcn variable mapping if present. Old theme files still present but unused by new code. Lint rule for raw values in place (warn). |
| WP-UI-02 | Icons & logo | 01 | `icons.tsx` (Appendix D), crest 64 px asset + chip component; icon-library usage migrated or justified. |
| WP-UI-03 | Primitives | 01, 02 | §9.1–9.13, §9.20–9.21 with Storybook (or a `/dev/ui` route if no Storybook) showing every state in both themes; unit tests for props/states; axe on stories. |
| WP-UI-04 | App shell & navigation | 03 | §6.2–6.3, §9.8–9.10; role-based nav; tab-in-URL; old layout removed. |
| WP-UI-05 | Student core screens | 04 | §11.1–11.3 (sign in, Today phone+desktop, Course). |
| WP-UI-06 | Player | 05 | §9.16, §11.4; Data saver; budgets for player route. |
| WP-UI-07 | Work & offline queue | 05 | §9.20, §10.4, §11.5; IndexedDB queue with Idempotency-Key replay; tests with network offline. |
| WP-UI-08 | Results & transcripts (student) | 05 | §9.17, §11.6. |
| WP-UI-09 | Teacher screens | 04 | §11.7–11.9, §9.18–9.19. |
| WP-UI-10 | Registrar & admin | 04 | §11.10 and composed admin screens (§11.11). |
| WP-UI-11 | Composed screens | 04 | Schedule, Profile, Verify, Quiz, session create, ops. |
| WP-UI-12 | Cleanup & enforcement | all | Delete old CSS/theme/components/UI-kit deps; flip raw-value lint to **error**; budgets and axe as required CI checks; final before/after screenshot set in `docs/ui-audit/after/`. |
WPs 05–11 can run in parallel once 04 merges; each owns its routes' folders. Shared component changes go through WP-UI-03's owner (contract-first: change the primitive in its own small PR).

### 15.2 Per-route migration recipe
1. Screenshot the current route (390/1280, light/dark). 2. Replace layout with the shell and §11 structure. 3. Swap every element for §9 components; delete local one-off styles. 4. Implement the five states (§10.1). 5. Apply §12 copy. 6. Run axe, budgets and visual tests. 7. PR with before/after screenshots and the checklist in §16.3.

### 15.3 Deletion rules
Remove an old component/style the moment its last usage is migrated (same PR). Remove a UI-kit dependency in WP-UI-12 at the latest. No `legacy/` folders, no commented-out code, no duplicate theme systems.

---

## 16. Verification and Definition of Done

### 16.1 Automated checks (CI)
- Visual regression (Playwright screenshots) for every §11 screen at 390×844 and 1280×900 in light and dark; the prototype artboards are the reference for review, not pixel-diff targets.
- axe: zero serious/critical violations on every §11 route and every Storybook story.
- Budgets (§14) enforced.
- Unit tests: every component variant/state renders; Badge maps every status to the exact word; SessionCard renders the correct action per state and role; attendance summary counts sum to the roster; GPA values render with two decimals.
- Network tests: offline submit queues and replays once (idempotency); slow 3G throttled player starts on 240p/audio; polling stops on hidden tabs.

### 16.2 Lint rules
- Disallow raw colour literals and px font sizes in `apps/web/src` except `styles/tokens.css`, the logo chip, video stage and `glim-green` text exceptions (allow-list by file/line comment `// design-exception: <reason>`).
- Disallow Tailwind arbitrary values (`-[`) except for geometry (`w-[…%]`), with the same exception comment.
- Disallow imports from third-party UI kits in routes.

### 16.3 PR checklist (paste into every UI PR)
- [ ] Uses only tokens / preset classes (no new exceptions, or each justified)
- [ ] Light and dark screenshots at 390 and 1280 attached (before/after)
- [ ] All five states implemented (loading, empty, error, offline, permission)
- [ ] Copy matches §12; strings through i18n if present
- [ ] Touch targets ≥ 44 px; focus visible; axe clean
- [ ] Budgets pass; no new fonts/images
- [ ] Old components/styles replaced here are deleted
- [ ] Behaviour unchanged (UI-8) or the change is called out and approved

### 16.4 Done means
Every route renders in the new system, the old styling system and UI-kit dependencies are gone, the raw-value lint is an error, budgets and axe are required checks, and the measurable goals in §1.2 are met on the staging build.

---

## Appendix A — `tokens.css` (verbatim; add to `apps/web/src/styles/tokens.css`)
Generated from the design system's `tokens.json` v1, plus the z-index scale from §4.2. Do not edit values here without updating the design system artifact.
```css
/* GLIM LMS — generated from tokens.json */
:root, [data-theme="light"] {
  --surface: #f5f7f5;
  --surface-raised: #ffffff;
  --surface-sunken: #e9eeeb;
  --line: #d6dfda;
  --line-strong: #7f8a84;
  --ink: #14201a;
  --ink-muted: #4f5d56;
  --glim-green: #01a958;
  --glim-red: #ed3135;
  --brand: #00753d;
  --brand-strong: #005a2f;
  --brand-soft: #dff3e8;
  --on-brand: #ffffff;
  --live: #c8202a;
  --live-soft: #fde6e6;
  --on-live: #ffffff;
  --success: #0f6b85;
  --success-soft: #e0f1f6;
  --warning: #8a5a00;
  --warning-soft: #fcf1d8;
  --danger: #9b1c3a;
  --danger-soft: #fbe5ea;
  --info: #2c55a0;
  --info-soft: #e5ecf8;
  --focus: #2563c9;
  --shadow-sheet: 0 -4px 16px rgba(24,32,28,0.10);
  --shadow-pop: 0 6px 20px rgba(24,32,28,0.14);
}
[data-theme="dark"] {
  --surface: #101513;
  --surface-raised: #171e1b;
  --surface-sunken: #0b0f0d;
  --line: #28322d;
  --line-strong: #66736c;
  --ink: #ecf2ee;
  --ink-muted: #a0aea7;
  --brand: #3fd08a;
  --brand-strong: #7fe2b0;
  --brand-soft: #0f2e1f;
  --on-brand: #04170d;
  --live: #ff7a7d;
  --live-soft: #3a1314;
  --on-live: #1f0405;
  --success: #7cc9e0;
  --success-soft: #0e2b33;
  --warning: #efbe5d;
  --warning-soft: #33270a;
  --danger: #ff9bb1;
  --danger-soft: #3a1420;
  --info: #9dbcf2;
  --info-soft: #162544;
  --focus: #8ab4f8;
  --shadow-sheet: 0 -4px 16px rgba(0,0,0,0.45);
  --shadow-pop: 0 6px 20px rgba(0,0,0,0.5);
}
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-8: 48px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-pill: 999px;
  --tap-min: 44px;
  --control-h: 48px;
  --control-h-sm: 36px;
  --nav-h: 64px;
  --content-max: 1120px;
  --bp-md: 640px;
  --bp-lg: 1024px;
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif;
  --z-sticky: 10;
  --z-nav: 20;
  --z-overlay: 40;
  --z-sheet: 50;
  --z-toast: 60;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace;
}
```
`base.css` must add: `html { color-scheme: light; } [data-theme="dark"] { color-scheme: dark; }`, `body { margin: 0; background: var(--surface); color: var(--ink); font-family: var(--font-sans); font-size: 16px; line-height: 24px; -webkit-font-smoothing: antialiased; }`, the global focus rule from §9, `::selection { background: var(--brand-soft); color: var(--ink); }`, and the reduced-motion block from §8.

---

## Appendix B — Tailwind preset and shadcn/ui variable mapping

### B.1 Tailwind preset (`apps/web/src/design/tailwind-preset.ts`)
Adapt the export style to the Tailwind major version found in the audit (v3 `presets: [...]` in `tailwind.config`; v4 `@theme` in CSS — in v4, declare the same names as `--color-*`, `--radius-*`, `--spacing-*` aliases pointing at our variables).
```ts
// Tailwind v3 preset. Colours resolve to CSS variables so both themes work without `dark:` variants.
const c = (n: string) => `var(--${n})`;
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    colors: {
      transparent: 'transparent', current: 'currentColor', white: '#ffffff',
      surface: { DEFAULT: c('surface'), raised: c('surface-raised'), sunken: c('surface-sunken') },
      line: { DEFAULT: c('line'), strong: c('line-strong') },
      ink: { DEFAULT: c('ink'), muted: c('ink-muted') },
      glim: { green: c('glim-green'), red: c('glim-red') },
      brand: { DEFAULT: c('brand'), strong: c('brand-strong'), soft: c('brand-soft'), on: c('on-brand') },
      live: { DEFAULT: c('live'), soft: c('live-soft'), on: c('on-live') },
      success: { DEFAULT: c('success'), soft: c('success-soft') },
      warning: { DEFAULT: c('warning'), soft: c('warning-soft') },
      danger: { DEFAULT: c('danger'), soft: c('danger-soft') },
      info: { DEFAULT: c('info'), soft: c('info-soft') },
      focus: c('focus'),
    },
    spacing: { 0: '0', px: '1px', 0.5: '2px', 1: c('space-1'), 2: c('space-2'), 3: c('space-3'), 4: c('space-4'), 5: c('space-5'), 6: c('space-6'), 8: c('space-8'),
               tap: c('tap-min'), control: c('control-h'), 'control-sm': c('control-h-sm'), nav: c('nav-h') },
    borderRadius: { none: '0', sm: c('radius-sm'), md: c('radius-md'), lg: c('radius-lg'), full: c('radius-pill') },
    boxShadow: { none: 'none', sheet: c('shadow-sheet'), pop: c('shadow-pop') },
    fontFamily: { sans: c('font-sans'), mono: c('font-mono') },
    fontSize: {
      caption: ['12px', { lineHeight: '16px', fontWeight: '600', letterSpacing: '0.02em' }],
      'body-sm': ['14px', { lineHeight: '20px' }],
      label: ['14px', { lineHeight: '20px', fontWeight: '600' }],
      body: ['16px', { lineHeight: '24px' }],
      heading: ['18px', { lineHeight: '24px', fontWeight: '600' }],
      title: ['22px', { lineHeight: '28px', fontWeight: '650' }],
      display: ['28px', { lineHeight: '34px', fontWeight: '700', letterSpacing: '-0.01em' }],
      code: ['14px', { lineHeight: '20px', fontWeight: '500' }],
      figure: ['32px', { lineHeight: '36px', fontWeight: '600' }],
    },
    screens: { md: '640px', lg: '1024px', xl: '1280px' },
    zIndex: { sticky: '10', nav: '20', overlay: '40', sheet: '50', toast: '60' },
    extend: { maxWidth: { content: c('content-max') } },
  },
};
```
Note the **replaced** (not extended) colour, spacing, radius and font-size scales: default Tailwind palettes (`gray-500`, `text-sm`, `p-7`…) become unavailable, which is how UI-1 is enforced at the class level. The spacing keys 7, 9–12 do not exist on purpose.

### B.2 shadcn/ui CSS variable mapping (only if the audit finds shadcn/ui)
Set in `base.css` after `tokens.css`, for both themes (they inherit automatically because they reference our variables):
| shadcn variable | Maps to |
|---|---|
| `--background` / `--foreground` | `var(--surface)` / `var(--ink)` |
| `--card` / `--card-foreground` | `var(--surface-raised)` / `var(--ink)` |
| `--popover` / `--popover-foreground` | `var(--surface-raised)` / `var(--ink)` |
| `--primary` / `--primary-foreground` | `var(--brand)` / `var(--on-brand)` |
| `--secondary` / `--secondary-foreground` | `var(--surface-sunken)` / `var(--ink)` |
| `--muted` / `--muted-foreground` | `var(--surface-sunken)` / `var(--ink-muted)` |
| `--accent` / `--accent-foreground` | `var(--brand-soft)` / `var(--brand-strong)` |
| `--destructive` / `--destructive-foreground` | `var(--danger)` / `#ffffff` (light) — prefer the `danger` outline variant (§9.1) |
| `--border` / `--input` / `--ring` | `var(--line)` / `var(--line-strong)` / `var(--focus)` |
| `--radius` | `var(--radius-md)` |
If the installed shadcn version expects HSL channel values instead of full colours, convert by editing its component classes to use the Tailwind preset names above rather than converting our tokens.

---

## Appendix C — Contrast matrix (WCAG 2 ratios, both themes)

| Foreground on background | Light | Dark | Required |
|---|---|---|---|
| `ink` on `surface` | 15.59 | 16.25 | 4.5:1 |
| `ink` on `surface-raised` | 16.78 | 14.95 | 4.5:1 |
| `ink` on `surface-sunken` | 14.30 | 17.00 | 4.5:1 |
| `ink-muted` on `surface` | 6.43 | 8.00 | 4.5:1 |
| `ink-muted` on `surface-raised` | 6.92 | 7.36 | 4.5:1 |
| `ink-muted` on `surface-sunken` | 5.90 | 8.37 | 4.5:1 |
| `ink-muted` on `live-soft` | 5.82 | 7.10 | 4.5:1 |
| `brand` on `surface-raised` | 5.81 | 8.56 | 4.5:1 |
| `brand` on `brand-soft` | 5.02 | 7.41 | 4.5:1 |
| `on-brand` on `brand` | 5.81 | 9.35 | 4.5:1 |
| `live` on `surface-raised` | 5.68 | 6.73 | 4.5:1 |
| `live` on `live-soft` | 4.77 | 6.49 | 4.5:1 |
| `on-live` on `live` | 5.68 | 7.73 | 4.5:1 |
| `success` on `success-soft` | 5.22 | 7.99 | 4.5:1 |
| `warning` on `warning-soft` | 5.28 | 8.50 | 4.5:1 |
| `danger` on `danger-soft` | 6.68 | 8.13 | 4.5:1 |
| `info` on `info-soft` | 6.07 | 7.89 | 4.5:1 |
| `line-strong` on `surface-raised` | 3.58 | 3.42 | 3:1 |
| `focus` on `surface` | 5.26 | 8.75 | 3:1 |
| `focus` on `surface-raised` | 5.67 | 8.05 | 3:1 |
| `#14201a` (ink, light value) on `glim-green` | 5.45 | same | 4.5:1 |
| `#ffffff` on `glim-green` (forbidden) | 3.08 | same | fails |

Success (teal-blue) and danger (plum-crimson) differ in hue family off the red–green axis and are always paired with words. Disabled controls (55 % opacity) are exempt from contrast requirements but must carry a visible reason (§9.1).

---

## Appendix D — Icon path data

| Name | SVG path `d` (24×24 viewBox, stroke 1.75, round caps/joins, fill none — except `play`, filled) |
|---|---|
| `home` | `M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9` |
| `book` | `M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5` |
| `calendar` | `M4 6h16v14H4zM4 10h16M8 3v4M16 3v4` |
| `play` | `M8 5v14l11-7z` |
| `video` | `M3 7h12v10H3zM15 10l6-3v10l-6-3` |
| `headphones` | `M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z` |
| `award` | `M12 3a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM8.5 14 7 22l5-3 5 3-1.5-8` |
| `user` | `M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0` |
| `clock` | `M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2` |
| `check` | `M5 12.5 10 17l9-10` |
| `alert` | `M12 3 2 20h20zM12 10v4M12 17v.5` |
| `info` | `M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.5v.5` |
| `wifiOff` | `M3 3l18 18M8.5 12.5a5 5 0 0 1 6-.8M5 9a10 10 0 0 1 4-2.2M12 18h.01M15.5 6.7A10 10 0 0 1 19 9` |
| `phone` | `M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z` |
| `chevronRight` | `M9 5l7 7-7 7` |
| `chevronLeft` | `M15 5l-7 7 7 7` |
| `upload` | `M12 21V9M7 14l5-5 5 5M4 4h16` |
| `file` | `M6 3h8l4 4v14H6zM14 3v4h4` |
| `users` | `M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 4 6` |
| `settings` | `M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1` |
| `bell` | `M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4` |
| `download` | `M12 3v12M7 10l5 5 5-5M4 20h16` |
| `search` | `M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4` |
| `menu` | `M4 7h16M4 12h16M4 17h16` |
| `close` | `M6 6l12 12M18 6 6 18` |
| `signal` | `M4 20v-3M9 20v-7M14 20v-11M19 20V5` |

Component: `<Icon name size? label? />` → `<svg width height viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` (or `role="img" aria-label` when `label` is given). Unknown names fall back to `info` and log a dev warning.

---

## Appendix E — Old→new mapping worksheet (fill in during WP-UI-00)
| Old item (path / route / class) | Kind (route · component · style · dependency) | Usages | New target (§ ref) | Action (KEEP+RESTYLE · REPLACE · DELETE · UNMAPPED) | Owner WP | Notes |
|---|---|---|---|---|---|---|
| `src/components/Button.tsx` | component | 143 | §9.1 Button | KEEP+RESTYLE | WP-UI-03 | add `live`, `quiet`, `loading`, `asChild` |
| `/dashboard` | route | — | §11.2 Student Today | REPLACE | WP-UI-05 | route path kept; redirect not needed |
| `@mui/material` | dependency | 61 imports | §9 primitives | REPLACE then DELETE | WP-UI-12 | budget: −120 KB |
*(Rows above are illustrative; replace them with the audit's real findings.)* The filled worksheet for this repository is in `docs/ui-audit.md`.

---

## Appendix F — Open questions (answer in `docs/decisions.md`; defaults in force until answered)
| ID | Question | Default used |
|---|---|---|
| UQ-1 | Official GLIM typefaces or a drawn wordmark? | System fonts; text wordmark "GLIM LMS" |
| UQ-2 | Is "GLIM LMS" the product name shown to students? | Yes |
| UQ-3 | Should dark theme follow the phone automatically or default to light? | Follow the phone |
| UQ-4 | Languages beyond English (Yoruba/Igbo/Hausa UI)? | English only; strings externalised |
| UQ-5 | Keep a separate tablet layout, or let ≥ 640 px use the phone layout with card grids? | Phone layout + grids until 1024 px |
| UQ-6 | Is a Storybook acceptable as a dev dependency, or should states be shown on a `/dev/ui` route? | Storybook if already present; otherwise `/dev/ui` (not shipped in production bundle) |
| UQ-7 | Is the existing frontend the build spec's React + Vite + Tailwind + shadcn/ui stack? | Assumed; the audit confirms or this file's §3 is adapted |
