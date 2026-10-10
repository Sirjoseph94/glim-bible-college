# UI audit — existing `apps/web` frontend (WP-UI-00)

**Date:** 10 Oct 2026 · **Commit audited:** `be2c386` · **Procedure:** `docs/ui-design-handoff.md` §2.1
**Status:** baseline recorded. **Blocked on the questions at the end** before WP-UI-04+ (user-facing `UNMAPPED` items and several conflicts with the TRD). WP-UI-01..03 (tokens, icons, primitives) can start once Q1, Q10, Q11 and Q16 are answered.

> Source-of-truth order used here: `docs/TRD.md` v3.0 and `GLOSSARY.md` win on behaviour, data and vocabulary (CLAUDE.md); the handoff wins on visual and interaction design. Where they collide the item is listed under **Questions** instead of being decided here.

---

## 1. Stack (read from `package.json` and config files)

| Area | Finding | Handoff assumption (UQ-7) |
|---|---|---|
| Framework | React 19.3.0 SPA, Vite 8.3.3, TypeScript (`apps/web/package.json`) | React 18 + Vite — **compatible** (React 19) |
| Router | `@tanstack/react-router` 1.170.41, code-based route tree in `src/router.tsx`, every page `lazyRouteComponent` except `/login` (in entry chunk) | — |
| Data | `@tanstack/react-query` 5.104.1; hand-written `api()` client typed from `@glim/contracts` (`src/api/client.ts`) | — |
| Styling | **Tailwind CSS 4.3.3** via `@tailwindcss/vite`; CSS-first config — the whole theme is `src/index.css` (`@import "tailwindcss"` + `@theme { --font-sans; --color-brand: #1e3a5f }`). **No `tailwind.config.*`.** Default Tailwind palette in use. | Appendix B.1 is a v3 preset → must be expressed as v4 `@theme` (Appendix B already allows this) |
| Component library | **None.** No shadcn/ui, Radix, MUI, Chakra, AntD. Shared helpers in `src/components/*`; most UI is inline Tailwind in route files. | TRD §18.1 says shadcn/ui; it was never installed |
| Variant helper | None (no `class-variance-authority`, `clsx`, `tailwind-merge`) | §3.1 → write a local `variants()`/`cn()` |
| Icons | **None.** One inline SVG (Google "G" mark in `components/google.tsx`). No icon library. | Appendix D set is greenfield |
| Forms | Uncontrolled `<form>` + `FormData` + `formText()` + `useSubmit()`; no react-hook-form (TRD §18.1 lists it; not installed) | — |
| Theme mechanism | None. Light only, no `dark:` classes, no `data-theme`, `<meta name="theme-color" content="#1e3a5f">` | UI-2 is greenfield |
| i18n | None. Strings are inline JSX literals (TRD §18.1 "strings externalised" not implemented) | §12 copy changes are value edits in JSX |
| PWA / service worker | None (`vite-plugin-pwa` not installed). Offline queues for quiz answers and roll call use `localStorage` (`routes/quiz.tsx`, `routes/roll-call.tsx`) | §9.20 wants IndexedDB |
| Fonts | System stack only; **0 `@font-face`, 0 Google Fonts, 0 `next/font`** | ✓ |
| Unit tests | Vitest configured, **0 test files** in `apps/web/src` | §16.1 needs component tests |
| E2E / a11y | Playwright 1.63.0 (`Pixel 7` project, real API + throwaway DB via `@glim/api e2e:serve`), `@axe-core/playwright` 4.13.0 (`e2e/wcag.spec.ts`), 28 specs | ✓ |
| Budgets | `scripts/budget-check.mjs` (gzip; initial JS 170/200 KB, route 60 KB, CSS 30 KB, ≤ 12 requests), `lighthouserc.cjs` (LCP ≤ 4 s on `/login`, `/apply`, `/verify/NOTACODE`) | Handoff §14 measures **brotli** and adds fonts = 0, images, player 40 KB, LCP on `/`, course, player |
| Storybook | None | UQ-6 default → `/dev/ui` route |

---

## 2. Route inventory

Roles are the client-side `beforeLoad` guards in `src/router.tsx` (the server authorizes every call — INV-1). "§11" is the handoff screen; paths are kept as they are (handoff §11 preamble).

| Route | File · export | Who reaches it | Handoff target | Status |
|---|---|---|---|---|
| `/login` | `routes/login.tsx` · `LoginPage` (entry chunk) | public, signed-out only | §11.1 Sign in | MAPPED |
| `/forgot` | `routes/forgot.tsx` · `ForgotPage` | public | — (§11.1 family) | composed, not specified |
| `/reset/$token` | `routes/reset.tsx` · `ResetPage` | public | — (§11.1 family) | composed, not specified |
| `/invite/$token` | `routes/invite.tsx` · `InvitePage` | public | §11.1 invite variant | MAPPED |
| `/verify/$code` | `routes/transcripts.tsx` · `VerifyPage` | public | §11.11 Transcript verify | MAPPED (composed) |
| `/apply` | `routes/apply.tsx` · `ApplyPage` | public | — | **UNMAPPED** (Applicant) |
| `/application` | `routes/application.tsx` · `ApplicationPage` | signed in (else → `/apply`) | — | **UNMAPPED** (Applicant) |
| `/application/edit` | `routes/application-edit.tsx` · `ApplicationEditPage` | signed in | — | **UNMAPPED** (Applicant wizard, 8 sections + photo) |
| `/` | `routes/home.tsx` · `HomePage` | any signed-in person (all roles share it) | §11.2 Student Today; §11.7 for Lecturers? | MAPPED for students; **Q6** for other roles |
| `/profile` | `routes/profile.tsx` · `ProfilePage` | signed in | §11.11 Profile | MAPPED (composed) |
| `/notifications` | `routes/notifications.tsx` · `NotificationsPage` | signed in | — | composed, not specified |
| `/registration` | `routes/student.tsx` · `RegistrationPage` | Student | — | **UNMAPPED** (registration + electives) |
| `/courses` | `routes/student.tsx` · `CoursesPage` | Student | §11.3 Course (as a list of `<details>` per course) | MAPPED, but §11.3 needs `/courses/$offeringId` (**Q5**) |
| `/recordings/$videoId` | `routes/recording.tsx` · `RecordingPage` | signed in | §11.4 Player (`/watch/:vodId`) | MAPPED; player model conflicts (**Q2**) |
| `/assignments/$assignmentId` | `routes/assignment.tsx` · `AssignmentPage` | signed in | §11.5 Assignment | MAPPED |
| `/quizzes/$quizId` | `routes/quiz.tsx` · `QuizPage` | signed in | §11.11 Quiz attempt | MAPPED (composed) |
| `/results` | `routes/results.tsx` · `MyResultsPage` | Student, Alumnus | §11.6 Results | MAPPED |
| `/transcripts` | `routes/transcripts.tsx` · `MyTranscriptsPage` | Student, Alumnus | §11.6 Transcripts card | MAPPED (**Q8**: separate page today) |
| `/transcripts/$transcriptId` | `routes/transcripts.tsx` · `TranscriptPage` | signed in | — | composed, not specified |
| `/course-results/$offeringId` | `routes/results.tsx` · `CourseResultsPage` | signed in (Lecturer finalizes; Registrar reviews) | §11.9 "Finalize results" | composed, not specified |
| `/teach` | `routes/teach.tsx` · `TeachPage` | Lecturer | §11.7 Lecturer Today + offering list | MAPPED; TRD `/teach/:offeringId` absent (**Q5**) |
| `/teach/meetings/$meetingId/attendance` | `routes/roll-call.tsx` · `MeetingAttendancePage` | signed in | §11.8 Attendance review | MAPPED |
| `/teach/meetings/$meetingId/roll-call` | `routes/roll-call.tsx` · `RollCallPage` | signed in | — | **UNMAPPED** (in-room roll call, offline queue) |
| `/teach/assignments/$assignmentId/grade` | `routes/assignment.tsx` · `GradeAssignmentPage` | signed in | — | composed, not specified |
| `/teach/quizzes/$quizId/grade` | `routes/quiz.tsx` · `QuizGradingPage` | signed in | — | composed, not specified |
| `/teach/offerings/$offeringId/gradebook` | `routes/gradebook.tsx` · `GradebookPage` | signed in | §11.9 Gradebook | MAPPED |
| `/results/semesters` | `routes/results.tsx` · `SemesterResultsPage` | System Admin, Registrar, Academic Admin | §11.10 Registrar semester results | MAPPED |
| `/results/transcripts` | `routes/transcripts.tsx` · `RegistrarTranscriptsPage` | System Admin, Registrar | §11.10 Transcript requests card | MAPPED (separate page today) |
| `/results/courses` | `routes/results.tsx` · `ResultsCoursesPage` | System Admin, Registrar, Academic Admin | — | composed, not specified |
| `/results/awards` | `routes/awards.tsx` · `AwardsPage` | System Admin, Registrar | — | composed, not specified |
| `/admin/grading-schemes` | `routes/admin-grading.tsx` · `AdminGradingPage` | System Admin, Registrar | — | composed, not specified |
| `/admin/academic` | `routes/admin-academic.tsx` · `AdminAcademicPage` | System Admin, Academic Admin | §11.11 Admin academic setup | MAPPED (composed) |
| `/admin/curricula/$curriculumId` | `routes/admin-curriculum.tsx` · `AdminCurriculumPage` | System Admin, Academic Admin | §11.11 | MAPPED (composed) |
| `/admin/calendar` | `routes/admin-calendar.tsx` · `AdminCalendarPage` | System Admin, Academic Admin | §11.11 | MAPPED (composed) |
| `/admin/offerings` | `routes/admin-offerings.tsx` · `AdminOfferingsPage` | System Admin, Academic Admin | §11.11 | MAPPED (composed) |
| `/admin/offerings/$offeringId` | `routes/admin-offerings.tsx` · `AdminOfferingPage` | System Admin, Academic Admin | §11.11 | MAPPED (composed) |
| `/admin/lecturers` | `routes/admin-offerings.tsx` · `AdminLecturersPage` | System Admin, Academic Admin | §11.11 | MAPPED (composed) |
| `/admin/imports` | `routes/admin-imports.tsx` · `AdminImportsPage` | System Admin, Academic Admin | §11.11 Imports | MAPPED (composed) |
| `/admin/users` | `routes/admin-users.tsx` · `AdminUsersPage` | System Admin | §11.11 | MAPPED (composed) |
| `/admin/users/$userId` | `routes/admin-user.tsx` · `AdminUserPage` | System Admin | §11.11 | MAPPED (composed) |
| `/admin/videos` | `routes/admin-videos.tsx` · `AdminVideosPage` | System Admin | §11.11 | MAPPED (composed) |
| `/admin/ops` | `routes/admin-ops.tsx` · `AdminOpsPage` | System Admin | §11.11 Ops failures | MAPPED (composed) |
| `/admin/jobs` | `routes/admin-ops.tsx` · `AdminJobsPage` | System Admin | §11.11 Ops | MAPPED (composed) |
| `/admin/audit` | `routes/admin-audit.tsx` · `AdminAuditPage` | System Admin | §11.11 | MAPPED (composed) |
| `/admin/settings` | `routes/admin-settings.tsx` · `AdminSettingsPage` | System Admin | §11.11 | MAPPED (composed) |
| `/admissions` | `routes/admissions-queue.tsx` · `AdmissionsQueuePage` | System Admin, Admissions Officer | — | **UNMAPPED** (Admissions Officer) |
| `/admissions/applications/$applicationId` | `routes/admissions-application.tsx` · `AdmissionsApplicationPage` | System Admin, Admissions Officer | — | **UNMAPPED** (sensitive section gated — INV-15) |
| `/admissions/intakes` | `routes/admissions-intakes.tsx` · `AdmissionsIntakesPage` | System Admin, Admissions Officer | — | **UNMAPPED** |
| `/admissions/reports` | `routes/admissions-reports.tsx` · `AdmissionsReportsPage` | System Admin, Admissions Officer | — | **UNMAPPED** |

Routes the handoff names that **do not exist**: `/courses/:offeringId?tab=`, `/watch/:vodId` (exists as `/recordings/$videoId`), `/courses/:id/work/:assignmentId` (exists as `/assignments/$assignmentId`), `/teach/sessions/:id/attendance` (exists as `/teach/meetings/$meetingId/attendance`), `/teach/:offeringId?tab=gradebook` (exists as `/teach/offerings/$offeringId/gradebook`), `/registrar/results` (exists as `/results/semesters`), a Schedule page (handoff §6.3 nav item, §11.11). TRD §18.2 routes not implemented: `/courses/:offeringId`, `/teach/:offeringId`, `/teach/meetings/:id`, `/application/offer`, `/admin/enrollment`, `/admin/people`, `/admin/integrations/*`, `/registrar/*` (implemented under `/results/*` and `/admin/grading-schemes`).

---

## 3. Component inventory

Usages = whole-word occurrences outside the defining file (`rg -w`), files = files that use it.

### 3.1 Shared components (`src/components/`)

| Component | Props | Used in | Usages | §9 target | Action |
|---|---|---|---|---|---|
| `form.tsx` `Field` | `InputHTMLAttributes & { label; error? }` | 15 files | 87 | §9.5 TextField | KEEP+RESTYLE — add `hint`, `optional`, `multiline`, 48 px height, error icon |
| `form.tsx` `SubmitButton` | `{ busy; children }` | 14 files | 58 | §9.1 Button (`primary`, `loading`, `block`) | REPLACE — thin wrapper over Button until call sites move, then delete. Today it swaps the label for "Please wait…" (§9.1 keeps the label and shows a spinner) |
| `form.tsx` `Alert` | `{ tone: "error" \| "success"; children }` | 38 files | 292 | §9.4 Banner | KEEP+RESTYLE — map `error→danger`; add `info`, `warning`, `offline`, `title`, `action`, `onDismiss` |
| `form.tsx` `Card` | `{ title; children }` (centred `max-w-sm` auth card with an `h2`) | 4 files | 12 | §9.6 Card + §11.1 auth layout | REPLACE — split into Card and an auth-page layout |
| `form.tsx` `formText` | `(FormData, name)` | 23 files | 149 | — (not visual) | KEEP |
| `google.tsx` `GoogleButton` | `{ href; label }`, inline 4-colour Google "G" SVG | 3 files | 6 | §9.1 Button `primary` "Continue with Google" | **UNMAPPED** detail — raw hex in the Google mark (**Q11**) |
| `google.tsx` `GOOGLE_ERRORS` | record of callback error copy | 3 files | 7 | §12.3 | KEEP, rewrite values to §12.3 |
| `meetings.tsx` `MeetingCard` | `{ meeting: ClassMeeting; children? }` | `UpcomingMeetings` (internal), `teach.tsx` via `actions` | — | §9.14 SessionCard | KEEP+RESTYLE → ClassMeetingCard (**Q1**, **Q3**) |
| `meetings.tsx` `JoinButton` | `{ meeting }`; calls `POST /class-meetings/:id/join`, then `window.location.assign` | internal only | 0 external | §9.14 join interaction | KEEP+RESTYLE — fold into the card; §9.14 asks for `window.open(…, noopener)` (UI-8 behaviour change → confirm) |
| `meetings.tsx` `UpcomingMeetings` | `{ title; as?; empty?; actions? }` | `home.tsx`, `teach.tsx` | 4 | §11.2 / §11.7 sections | KEEP+RESTYLE |
| `meetings.tsx` `myScheduleQuery`, `ScheduleItem` | query / type | 1 file | 4 / 2 | — | KEEP |
| `assignments.tsx` `CourseAssignments` | `{ offeringId, … }` | `student.tsx`, `teach.tsx` | 4 | §11.3 Work tab rows | KEEP+RESTYLE |
| `assignments.tsx` `assignmentsKey`, `useAssignments` | query helpers | exported, unused outside | 0 | — | KEEP (un-export) |
| `course-content.tsx` `CourseMaterials` | offering materials list/editor | `student.tsx`, `teach.tsx` | 4 | §11.3 Materials tab | KEEP+RESTYLE |
| `course-content.tsx` `CourseAnnouncements` | announcements list/editor | `student.tsx`, `teach.tsx` | 4 | — (§11.3 has no Announcements tab; TRD §18.2 has one) | **UNMAPPED** (**Q5**) |
| `course-content.tsx` `SafeHtml` | sanitized HTML | 1 file | 2 | — | KEEP |
| `grades.tsx` `MyGrades` | student's released grades | `student.tsx` | 2 | §11.3 Grades tab / §9.17 ResultRow | KEEP+RESTYLE |
| `quizzes.tsx` `CourseQuizzes` | quizzes list/editor | `student.tsx`, `teach.tsx` | 4 | §11.3 Work tab | KEEP+RESTYLE |
| `password-form.tsx` `PasswordForm` | set/confirm password | `invite.tsx`, `reset.tsx` | 4 | §9.5 + §11.1 invite | KEEP+RESTYLE |
| `time.tsx` `Time`, `CalendarDate`, `browserTimeZone` | viewer zone + Lagos alongside (C-27) | 23 / 6 / 1 files | 65 / 23 / 2 | §10.6 formatting | KEEP — format strings move to §10.6 ("Tue 13 Oct", "10:00 – 11:00") |
| `upload.ts`, `passport-photo.ts`, `use-submit.ts` | non-visual helpers | 4 / 1 / 30 files | 8 / 2 / 92 | — | KEEP |

### 3.2 Layout and inline patterns (no shared component today)

| Old item | Where | Count | §9 target | Action |
|---|---|---|---|---|
| `RootLayout` header: institution name `<h1>` + a wrapping row of up to 25 underlined text links + "Sign out" | `routes/root.tsx` | 1 | §6.2 AppShell, §9.8 BottomNav/NavRail, §9.9 TopBar | REPLACE (WP-UI-04). Also the institution name is the page's only `<h1>`; every page title is an `<h2>` (§13 wants the page title as `<h1>`) |
| Unread count in nav text "Notifications (3)" | `root.tsx` | 1 | §9.21 NotificationDot (never a number) | REPLACE |
| Inline-styled `<button>` | all routes | 139 | §9.1 Button | REPLACE |
| `<select>` | routes | 38 | §9.5 Select | REPLACE |
| `<textarea>` | routes | 15 | §9.5 TextArea | REPLACE |
| checkbox / radio inputs | routes | 19 / 7 | §9.5 Checkbox / Radio | REPLACE |
| `<table>` | 9 | 9 | §9.19 DataTable | REPLACE |
| `<details>/<summary>` disclosures (course sections, recordings, attendance, results) | `student.tsx`, `results.tsx`, others | 18 | §9.7 Tabs (course page) / collapsible sections (§11.6 — no component spec) | REPLACE; collapsible section needs a spec (**Q12**) |
| `animate-pulse` skeleton blocks | many | 39 | §9.12 Skeleton (static, no shimmer) | REPLACE |
| State labels in `STATE_LABELS` ("Open", "Live now", "Ended", "Cancelled", "Didn't take place") rendered as grey/red chips | `meetings.tsx` | 1 | §9.3 Badge | REPLACE (**Q3**) |
| `role="status"`/`aria-live` regions | — | 0 | §13 live regions | add |
| `role="alert"` | `Alert` | 1 | §9.4 | keep |
| `<img>` (passport photos, `w-[149px]`) | `application-edit.tsx`, `admissions-application.tsx` | 4 | — | **UNMAPPED** (passport photo preview) |
| `localStorage` offline queues (quiz answers, roll-call marks) | `quiz.tsx`, `roll-call.tsx` | 2 | §9.20 IndexedDB queue | REPLACE in WP-UI-07 |

---

## 4. Style inventory (commands from §2.1 step 4, run in `apps/web`)

**Raw colours** (`#hex`, `rgb()`, `hsl()`):
```
src/index.css:5:  --color-brand: #1e3a5f;
src/components/google.tsx:23:          fill="#EA4335"
src/components/google.tsx:27:          fill="#4285F4"
src/components/google.tsx:31:          fill="#FBBC05"
src/components/google.tsx:35:          fill="#34A853"
index.html:6:    <meta name="theme-color" content="#1e3a5f" />   (outside src; found separately)
```

**Raw px sizes / arbitrary text & padding:**
```
src/routes/application-edit.tsx:845:          className="h-48 w-[149px] rounded border border-slate-200 object-cover"
src/routes/admissions-application.tsx:124:          className="h-48 w-[149px] rounded border border-slate-200 object-cover"
```

**Fonts loaded:** none (`@font-face`, `fonts.googleapis`, `next/font`: 0 matches).

**Tailwind arbitrary values (`-[`):**
```
src/routes/profile.tsx:27:            grid-cols-[max-content_1fr]
src/routes/admin-offerings.tsx:399:   sm:grid-cols-[1fr_2fr_auto]
src/routes/transcripts.tsx:589:       grid-cols-[auto,1fr]
src/routes/admin-curriculum.tsx:100:  min-w-[36rem]
src/routes/application-edit.tsx:845:  w-[149px]
src/routes/admissions-application.tsx:44: sm:grid-cols-[12rem_1fr]
src/routes/admissions-application.tsx:124: w-[149px]
```

The real inventory is the **default Tailwind palette and scale**, which Appendix B removes. Counts across `apps/web/src`:

| Kind | Classes (occurrences) |
|---|---|
| Colour families (bg/text/border/ring/…) | `slate` 525 · `white` 139 (+ `/20`, `/40`) · `brand` 113 (+ `/10`, `/30`, `/40`) · `red` 49 · `amber` 22 · `green` 14 · `blue` 11 · `black` 2 (+ `/70`) |
| Text sizes | `text-sm` 247 · `text-xl` 47 · `text-xs` 21 · `text-lg` 10 · `text-base` 5 · `text-2xl` 2 |
| Radius | `rounded` 281 · `rounded-lg` 1 · `rounded-full` 1 |
| Shadow | `shadow-sm` 1 · `shadow` 1 |
| Motion | `animate-pulse` 39 |
| `dark:` variants | 0 |

Note: the current `brand` is navy `#1e3a5f`, not GLIM green. Every `bg-brand`/`text-brand` changes colour the moment WP-UI-01 redefines `--color-brand`; that is intended, but WP-UI-01 must check the 113 brand usages for contrast against the new value (e.g. `text-white` on `bg-brand` is fine in light, wrong in dark where `on-brand` is near-black).

---

## 5. Budget baseline (production build, `pnpm --filter @glim/web build`)

| Measure | gzip | brotli | Budget (handoff §14) |
|---|---|---|---|
| Initial JS (entry closure: 5 files, incl. `/login`) | 109.6 KB | 95.6 KB | ≤ 170 KB br ✓ |
| Initial CSS | 5.5 KB | 4.7 KB | ≤ 30 KB ✓ |
| Requests to first screen (`budget-check` estimate: document + 5 JS + 1 CSS + `GET /institution`) | 8 | | ≤ 12 ✓ |
| Largest route chunk | `teach.tsx` 12.0 KB | | ≤ 60 KB ✓ |
| Player route (`recording.tsx`) | 2.2 KB (YouTube IFrame API loaded on tap, outside the bundle) | | ≤ 40 KB ✓ |
| Fonts downloaded | 0 | | 0 ✓ |

All route chunks (gzip, own code only): admin-academic 1.8 · admin-audit 1.1 · admin-calendar 2.2 · admin-curriculum 3.8 · admin-grading 3.3 · admin-imports 2.5 · admin-offerings 3.0 · admin-ops 1.7 · admin-settings 2.0 · admin-user 2.0 · admin-users 1.9 · admin-videos 2.1 · admissions-application 3.6 · admissions-intakes 1.3 · admissions-queue 2.2 · admissions-reports 1.5 · application-edit 8.8 · application 2.4 · apply 1.3 · assignment 3.8 · awards 1.5 · forgot 0.6 · gradebook 4.1 · home 1.8 · invite 0.9 · notifications 2.1 · profile 1.7 · quiz 4.4 · recording 2.2 · reset 0.9 · results 3.5 · roll-call 3.0 · student 8.8 · teach 12.0 · transcripts 4.0 KB.

Headroom: ~74 KB brotli of initial JS for the design layer (tokens, icons, primitives, shell, Radix if approved).

**Lighthouse LCP:** not recorded in this audit. `lighthouserc.cjs` only covers public routes (`/login`, `/apply`, `/verify/NOTACODE`); `/`, a course page and the player need signed-in LHCI runs (a puppeteer login script), which do not exist yet. Proposed for WP-UI-01 (**Q14**).

---

## 6. Accessibility baseline and screenshots

**How it was run.** The whole e2e suite (`pnpm --filter @glim/web test:e2e`; 33 existing specs, all passing) seeds a realistic database through the UI. Two throwaway audit specs then captured each route at 390×844 and 1280×900, ran axe (`wcag2a/aa`, `wcag21a/aa`) at 390 px, and counted requests until network idle. The audit specs were not committed. Only one light theme exists, so there are no dark screenshots. Images are in `docs/ui-audit/before/` (JPEG, CSS-pixel size, full page).

| Route (persona) | axe violations | Requests to idle | Fonts / images | Horizontal scroll at 390 |
|---|---|---|---|---|
| `/login` (public) | 0 | 9 | 0 / 0 | no |
| `/apply` (public) | 0 | 11 | 0 / 0 | no |
| `/forgot` (public) | 0 | 10 | 0 / 0 | no |
| `/verify/NOTACODE` (public) | 0 | 11 | 0 / 0 | no |
| `/` (student/alumnus) | 0 | 14 | 0 / 0 | no |
| `/results` (student/alumnus) | 0 | 12 | 0 / 0 | no |
| `/transcripts` (student/alumnus) | 0 | 13 | 0 / 0 | no |
| `/notifications` (student/alumnus) | 0 | 14 | 0 / 0 | no |
| `/profile` (student/alumnus) | 0 | 12 | 0 / 0 | no |
| `/` (Lecturer) | 0 | 14 | 0 / 0 | no |
| `/teach` (Lecturer) | 0 | 16 | 0 / 0 | no |
| `/teach/offerings/:id/gradebook` (Lecturer) | 0 | 12 | 0 / 0 | no |
| `/teach/meetings/:id/roll-call` (Lecturer) | 0 | 12 | 0 / 0 | no |
| `/results/semesters` (Registrar) | 0 | 14 | 0 / 0 | no |
| `/results/transcripts` (Registrar) | 0 | 12 | 0 / 0 | no |
| `/admin/users` (System Admin) | 0 | 13 | 0 / 0 | no |
| `/admin/ops` (System Admin) | 0 | 13 | 0 / 0 | no |

The existing `e2e/wcag.spec.ts` also passes (0 violations on `/login`, `/apply`, `/forgot`, `/verify`, Lecturer `/`, `/teach`, `/notifications`, `/profile`, the Registrar's five results pages and four System Admin pages).

**Findings and gaps**
- **axe is clean** on every route captured. The §1.2 target (0 serious/critical) is already met. The overhaul must keep it there, not fix a backlog.
- **Requests:** `/login` makes 9 requests (the document, the entry JS and CSS, and its API calls), within ≤ 12. Signed-in pages make 12–16 by network idle because each fires several API calls (e.g. `/teach` 16). These are not "requests to first interactive screen" in the strict sense, but WP-UI-04/05 should not add more on first load.
- **Student screenshots show an alumnus.** The only seeded student with a password (`e2e-student2`) has graduated by the time the suite reaches its last specs (`terminal-transcripts`). Before the next spec erases them, they see the alumnus nav, and `/courses` and `/registration` redirect to `/`. Those two files (`student_courses@*`, `student_registration@*`) therefore show Home. **Not captured:** an active student's Today, Courses and Registration, the player (`/recordings/:id`), the assignment page, and the course page, because their links sit inside collapsed `<details>` and the student had graduated. Lighthouse LCP was not measured (see §5). Each screen WP takes its own "before" shots per §15.2 step 1, so this needs an active-student fixture first. *Proposal:* WP-UI-05 adds a seeded student with a password who is never graduated.
- **Visible current design** (see screenshots): a navy (`#1e3a5f`) header bar with the institution name and a wrapping row of underlined links (alumnus 5, Lecturer 5, admins many more); content in a single `max-w-3xl` column at every width (no desktop layout); white bordered cards on `slate-50`; actions are underlined text links ("Start class · Roll call · Reschedule · Cancel class") rather than buttons, and destructive "Cancel class" is a red link beside the others; times show UTC with Lagos alongside ("09:04 UTC (10:04 Lagos)") because the test browser is in UTC (C-27); the student/alumnus Home is a greeting with nothing under it when there are no Class Meetings (no empty state).

---

## 7. Appendix E — old → new mapping

| Old item | Kind | Usages | New target | Action | Owner WP | Notes |
|---|---|---|---|---|---|---|
| `src/index.css` `@theme` (`--font-sans`, `--color-brand: #1e3a5f`) | style | 1 file | Appendix A `styles/tokens.css` + `base.css` + v4 `@theme` mapping (App. B) | REPLACE | WP-UI-01 | Tailwind v4: express the preset as `@theme` with `--color-*: initial` to drop the default palette |
| Default Tailwind palette/scale classes (`slate-*`, `text-sm`, `rounded`, …) | style | ~880 colour + ~330 size | Preset classes (`ink-muted`, `text-body-sm`, `rounded-sm`…) | REPLACE | each screen WP; enforced WP-UI-12 | Removing the default palette in WP-UI-01 would break every page at once → keep defaults until WP-UI-12, lint as warn |
| `index.html` `theme-color #1e3a5f`, `<title>GLIM Bible College</title>` | style | 1 | `surface`/brand per theme; product name (**Q13**) | REPLACE | WP-UI-01 | |
| `routes/root.tsx` `RootLayout` | component | 1 (root) | §6.2 AppShell, §9.8, §9.9 | REPLACE | WP-UI-04 | needs nav grouping for 8 roles (**Q6**) |
| `components/form.tsx` `Field` | component | 87 | §9.5 TextField | KEEP+RESTYLE | WP-UI-03 | |
| `components/form.tsx` `SubmitButton` | component | 58 | §9.1 Button | REPLACE | WP-UI-03 → delete when unused | |
| `components/form.tsx` `Alert` | component | 292 | §9.4 Banner | KEEP+RESTYLE | WP-UI-03 | |
| `components/form.tsx` `Card` | component | 12 | §9.6 Card + auth layout | REPLACE | WP-UI-03/05 | |
| `components/google.tsx` `GoogleButton` | component | 6 | §9.1 Button + Google mark | UNMAPPED | WP-UI-02 | **Q11** |
| `components/meetings.tsx` `MeetingCard` + `JoinButton` | component | 4 | §9.14 SessionCard | KEEP+RESTYLE | WP-UI-03 (component), 05/09 (screens) | **Q1**, **Q3** |
| `components/meetings.tsx` `UpcomingMeetings` | component | 4 | §11.2 / §11.7 sections | KEEP+RESTYLE | WP-UI-05, 09 | |
| `components/assignments.tsx`, `quizzes.tsx`, `course-content.tsx`, `grades.tsx` | component | 4 each | §11.3 tabs, §9.17 | KEEP+RESTYLE | WP-UI-05 | Announcements has no tab in §11.3 |
| `components/password-form.tsx` | component | 4 | §9.5 / §11.1 | KEEP+RESTYLE | WP-UI-05 | |
| Inline `<button>` / `<select>` / `<textarea>` / checkbox / radio | component | 139 / 38 / 15 / 19 / 7 | §9.1 / §9.5 | REPLACE | per screen WP | |
| Inline `<table>` | component | 9 | §9.19 DataTable | REPLACE | WP-UI-09/10 | |
| `<details>` disclosures | component | 18 | §9.7 Tabs / collapsible section | REPLACE | WP-UI-05/08 | **Q12** |
| `animate-pulse` skeletons | style | 39 | §9.12 Skeleton | REPLACE | per screen WP | |
| `localStorage` offline queues | pattern | 2 | §9.20 IndexedDB queue | REPLACE | WP-UI-07 | roll call is unmapped (**Q4**) |
| `/` | route | — | §11.2 Student Today | KEEP path, REPLACE screen | WP-UI-05 | other roles (**Q6**) |
| `/courses` | route | — | §11.3 | REPLACE | WP-UI-05 | needs `/courses/$offeringId` (**Q5**) |
| `/recordings/$videoId` | route | — | §11.4 | KEEP path, RESTYLE | WP-UI-06 | **Q2** |
| `/assignments/$assignmentId` | route | — | §11.5 | KEEP path, RESTYLE | WP-UI-07 | |
| `/results`, `/transcripts` | route | — | §11.6 | RESTYLE | WP-UI-08 | **Q8** |
| `/teach` | route | — | §11.7 | RESTYLE | WP-UI-09 | |
| `/teach/meetings/$id/attendance` | route | — | §11.8 | RESTYLE | WP-UI-09 | |
| `/teach/offerings/$id/gradebook` | route | — | §11.9 | RESTYLE | WP-UI-09 | |
| `/results/semesters`, `/results/transcripts` | route | — | §11.10 | RESTYLE | WP-UI-10 | |
| `/teach/meetings/$id/roll-call` | route | — | — | UNMAPPED | WP-UI-09? | **Q4** |
| `/apply`, `/application`, `/application/edit` | route | — | — | UNMAPPED | ? | **Q7** |
| `/admissions/*` (4 routes) | route | — | — | UNMAPPED | WP-UI-10? | **Q7** |
| `/registration` | route | — | — | UNMAPPED | WP-UI-11? | **Q7** |
| Other admin/registrar/lecturer routes (see §2) | route | — | §11.11 composed | RESTYLE | WP-UI-10/11 | |
| Third-party UI kit | dependency | 0 | — | n/a | — | nothing to remove |
| `@radix-ui/*` | dependency | 0 (not installed) | §3.1 primitives | ADD? | WP-UI-03 | **Q10** |

---

## 8. Questions (answers go in `docs/decisions.md`; WP-UI-04+ waits on the user-facing ones)

**Conflicts between the handoff and the TRD / GLOSSARY / CLAUDE.md**

- **Q1 — Vocabulary.** The handoff uses "Teacher", "session"/SessionCard, "your teacher", "Teacher view", and its role table says Teacher; `GLOSSARY.md` and `CLAUDE.md` forbid "teacher" and unqualified "session" (use **Lecturer**, **Class Meeting**, **Matric Number**). The design-system samples also say "your teacher". *Proposal:* GLOSSARY wins everywhere: UI copy says Lecturer/class; code names `ClassMeetingCard`, role `lecturer`; §12 copy rewritten accordingly (e.g. "Your Lecturer may deduct marks").
- **Q2 — Player model.** Handoff §9.16/§11.4/§14 describe our own HLS player (`hls.js`, quality rungs 240p–720p with MB/hour, Audio only, token refresh, captions toggle, Data saver ⇒ audio only, 180-day recording window). The TRD v3.0 (INV-9/INV-10, ADR-0002/0003, decision C-43) and the code use **unlisted YouTube embeds** by id behind a tap-to-load facade, with a 144p data-saver tip; recordings are kept **indefinitely** (ADR-0002 says "no 180-day purge"). Our own quality menu and audio-only playback can't be built on the YouTube embed. *Proposal:* WP-UI-06 restyles the facade, stage, resume banner and data-saver tip; drop QualityMenu, Audio only and the purge empty state unless the video decision changes.
- **Q3 — Class Meeting display states.** The handoff's SessionCard states are scheduled/open/live/ended/processing/available/cancelled ("build spec §10.4"). The contracts' `class_meetings.state` is `SCHEDULED, OPEN, LIVE, ENDED, CANCELLED, NO_SHOW`; the schedule API (`GET /me/schedule`) returns no recording status per meeting, and there is no "processing" state for YouTube links. *Proposal:* SessionCard covers the six real states (NO_SHOW → "Didn't take place", neutral); "Recording ready" only where the API returns a linked published video — or raise an API change.
- **Q4 — Roll call.** TRD §18.4 makes the phone-first roll call (on-campus students first, Present/Late/Absent toggles, "mark all present", offline queue) a key interaction; the handoff has no screen or component for it. Needs a spec (or "compose from §9.18 AttendanceRow + §9.20").
- **Q5 — New routes.** §11.3 (Course tabs: Overview, Live, Recordings, Work, Grades, Materials) needs `/courses/$offeringId` and §11.9 implies `/teach/$offeringId?tab=`; both are in TRD §18.2 but not in the code (courses are `<details>` blocks on `/courses` and `/teach`). Adding them is a route change (UI-8). Also: TRD's course tabs include Schedule, Quizzes & Exams, Announcements — the handoff's don't (Announcements has no home). *Proposal:* add the two routes in WP-UI-05/09 (old pages become lists linking to them), map Announcements into Overview.
- **Q6 — Navigation for all roles.** §6.3 covers Student, Teacher and "Registrar / admin" (4–5 items). The app has Applicant, Student, Alumnus, Lecturer, Admissions Officer, Academic Admin, Registrar and System Admin, and staff routinely hold several roles (today's header shows up to 25 links). Needs: nav items per role, how a System Admin reaches ~20 admin pages (a "More"/Settings hub?), what `/` shows for non-students (Lecturer → §11.7 at `/` or keep `/teach`?), and the role switcher's precedence.
- **Q7 — Unmapped user-facing screens.** Admissions (public `/apply`, applicant `/application` + 8-section wizard with passport photo, Admissions Officer queue/application/intakes/reports) and student `/registration` have no handoff spec or artboard. *Proposal:* compose from §9/§10 under WP-UI-11 ("composed, not specified"), keeping INV-15 (sensitive answers stay in Admissions) unchanged.
- **Q8 — Transcripts placement.** §11.6 puts the Transcripts card on `/results` and §11.10 puts transcript requests on the Registrar results page; today both are separate routes (`/transcripts`, `/results/transcripts`). Merge or keep separate pages and link?
- **Q9 — Data the API doesn't return** (UI-8 "stop and raise"): "Continue watching" + resume position on Today, "Recordings watched" progress per course, "Due this week", dial-in numbers/PIN on the live card, "18 students are in the Meet lobby", "Needs your attention" items for Lecturers, per-recording MB estimates, results-published notice timing. Each screen WP must confirm its data exists or raise an API change; none is assumed.

**Design-layer decisions needed before WP-UI-01..03**

- **Q10 — New dependencies.** §3.1 wants Radix UI (Dialog, DropdownMenu, Tabs, RadioGroup, Checkbox, Switch). None is installed; adding them is a new runtime dependency (budget headroom is ~74 KB br). Approve `@radix-ui/react-*`, or build these primitives in-house?
- **Q11 — Google sign-in button.** §11.1 makes "Continue with Google" a `primary` brand-green button. Google's sign-in branding rules govern that button's look and require the four-colour "G" mark (raw hex today). Approve a `design-exception` for the mark, and confirm the button style is acceptable under Google's guidelines (or use Google's light/neutral button style).
- **Q12 — Collapsible section.** §11.6 ("earlier semesters as collapsible sections") and today's 18 `<details>` need a component spec (native `<details>` restyled is the cheapest). OK to add it to §9 as "Disclosure"?
- **Q13 — Product name.** The header shows the institution name from `GET /institution` (editable in Settings) and the page title is "GLIM Bible College"; the handoff's wordmark is "GLIM LMS" (UQ-2). Which one, and does the admin-editable name still appear anywhere?
- **Q14 — Budget tooling.** Handoff §14 measures brotli and adds fonts = 0, images, player ≤ 40 KB and signed-in LCP routes; `budget-check.mjs` measures gzip and LHCI covers public routes only. *Proposal:* WP-UI-01 extends `budget-check.mjs` (brotli + gzip) and adds a Playwright font/image request check; signed-in LHCI comes in WP-UI-12.
- **Q15 — Handoff references.** The handoff cites `SCHOOL_LMS_BUILD_SPEC.md` v2.1 ("§17", "§10.4", "§12.7", "§13.1", "§8.1", "LIVE-008"); this repo's spec is `docs/TRD.md` v3.0 (frontend is §18). Treat those as the TRD's equivalent sections?
- **Q16 — Default palette removal timing.** Appendix B replaces Tailwind's palette, which would break all ~1,200 unmigrated class usages in WP-UI-01. *Proposal:* add tokens alongside the defaults in WP-UI-01 (lint = warn) and remove the defaults in WP-UI-12, as §15.1 allows.

**Assets**

- The crest `new-ncgc-logo-162.png` is in the design-system artifact's asset store (asset id `7fef724a50a2bfdcde50d6406f4aff8e`), not in its published files; WP-UI-02 fetches it from there and generates the 64 px copy.
