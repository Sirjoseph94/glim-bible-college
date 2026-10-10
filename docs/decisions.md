# Owner decisions

The record of what GLIM's owner has decided, and the defaults still awaiting confirmation. `docs/TRD.md` §2 summarises these decisions and builds on them. Architecture decisions with trade-offs are in `docs/adr/`.

**How to use this file:** when the owner answers an open item, change its status here, update the TRD section it points to, and note the date.

## Spec vetting, 4–6 October 2026

### Scope and shape

| Topic | Decision | TRD |
|---|---|---|
| Product scope | The spec's academic and teaching scope (learning platform + academic records), **plus admissions/applications**. The paper Diploma application form is the reference. **Fees and payments are out**, as are hostel, library, HR and ministry practicum. | §3, §10 |
| Tenancy | **GLIM only.** Multi-tenancy is removed. | ADR-0001 |
| Delivery | **Hybrid.** The same class runs in a room and on Google Meet at once. | §11, §12 |
| Scale | About **100–200 students and 10–25 staff**. Classes of 15–30, with 3–5 running at the same time. | §21.4, §22.2 |
| Operations | One **System Admin** operates everything. **DigitalOcean App Platform** for the server, Managed PostgreSQL for the database, **SendGrid** for email. | ADR-0002, §22 |
| Video | A managed service rather than self-hosting. The provider is now **YouTube, unlisted** (C-43, 7 Oct 2026; replaced Cloudflare Stream). Files go in DigitalOcean Spaces. Cloudflare R2 and the Worker are dropped. | ADR-0002, ADR-0003, §13 |

### Vocabulary (see `GLOSSARY.md`)

- **Academic Session** means the academic year.
- A live or room class is a **Class Meeting**.
- A login is never called a "session".
- Use **Matric Number** (not student number) and **Lecturer** (not teacher).
- **Level** is "Year 1" or "Year 2".

### Documentation

- `docs/TRD.md` is the single source of truth, now v3.0. The original v2.1 is archived at `docs/archive/TRD-v2.1.md`.
- References to the old TRD v1.0 requirement IDs were removed.

### Recordings

| Topic | Decision | TRD |
|---|---|---|
| Retention (Q-04) | Recordings **persist**, with no time-based purge. | §13.5 |
| Management | The System Admin can **upload, edit (title, description, order), replace, download the original, and delete** videos. Trimming is out. Students can never download. | §13.6 |
| Student access | Lasts **until the student's programme enrollment ends** (they graduate or withdraw). Staff keep access. | §13.5 |

### Teaching and attendance

| Topic | Decision | TRD |
|---|---|---|
| In-room attendance | The Lecturer takes **roll call** on a phone or laptop. Online students are counted from Meet. Each record stores whether the student attended in person or online. | §12.3 |
| Rooms | Each Class Meeting may have a **Room**, and a Room can't be double-booked. The room laptop joins Meet as the Lecturer, so recording starts. | §11.5 |
| Times | Shown in the **viewer's own timezone**, with Lagos time alongside. | §5.1 |
| Exams | In-room students sit **paper exams** and the Lecturer enters the scores; online students take a **timed online exam**. No proctoring. | §14.2 |
| Study Mode | Each applicant chooses **On-campus or Online** on the application. Actual attendance is recorded per Class Meeting. Room capacity isn't enforced. | §10.2 |

### Roles

Six institution-wide roles:
- **System Admin**
- **Admissions Officer**
- **Registrar**
- **Academic Admin**
- **Lecturer** (derived from lecturer assignments)
- **Student** (derived)

There's also the derived **Applicant**. Auditor, Platform Admin, departments and scoped roles are dropped (TRD §7).

### Programmes, calendar, grading

| Topic | Decision | TRD |
|---|---|---|
| Programmes | A **1-year Certificate** and a **2-year Diploma**, which are **separate programmes**. Compulsory courses each semester are fixed and auto-registered; **students may pick elective courses available to their Level and semester**. | §9.3 |
| Grading | **NUC 5-point** letter bands for every course. **Award classes** are configured per programme: **Distinction 4.50–5.00, Credit 3.00–4.49, Pass 1.00–2.99, no award below 1.00**. Repeat policy BEST. Results are visible when the Lecturer finalizes them. | §14.4 |
| Calendar | The Academic Session starts in **September**, with **two semesters** (Sept–Jan, Feb–June) and exams at the end of each. | §9.1 |
| Admissions | **One intake a year:** applications open in **November** and close in **June**, and are reviewed as they arrive. The flow is DRAFT → SUBMITTED → UNDER_REVIEW → ADMITTED/REJECTED → ACCEPTED. An offer must be accepted within **21 days** or it lapses, and an officer can reopen it. There are no interview or waitlist states. | §10 |

### Application form handling

- Applicants **sign in with Google** to apply and can save drafts. That Gmail becomes their student login and their Meet identity. **A Google account is required.**
- The signature is a **typed full name, a checkbox and a timestamp**. The Statement of Faith is linked from the declaration.
- The **passport photo** is uploaded and reused as the student photo.
- **Spiritual-background answers** are visible only to Admissions Officers and the System Admin, and are **never copied** into the student record.
- **Rejected applications are deleted after 12 months.**
- **Referral codes** are personal codes for students, alumni and staff, with a "referred by" report.

### Other answers

| Topic | Decision |
|---|---|
| Messaging | **WhatsApp/SMS are out of v1.** WhatsApp numbers are stored for later. |
| Q-11 | A student without a linked Google account knocks, and a host admits them. |
| Q-12 | English only. |
| Q-15 | No students under 18. |
| Q-18 | Official transcripts wait for Registrar approval. Unofficial transcripts show finalized results marked *Provisional*. |
| Recording consent | Notice only. |
| DPAs | Data processing agreements or terms reviews for DigitalOcean, Google (Workspace and YouTube) and SendGrid are a launch requirement. |

### Kept from v2.1 (still in force)

PostgreSQL 18, Drizzle, pg-boss (no Redis), Google Workspace Business Standard with 2 host accounts, students on personal Gmail, NUC 5-point with repeat policy BEST, transcripts with serial + QR + hash, the October 2026 legal review of cross-border hosting, Drive cleanup after ingest, and the System Admin owning the Google setup.

## 7 October 2026

| Topic | Decision | TRD |
|---|---|---|
| Video host (C-42), **superseded by C-43** | **Cloudflare Stream.** Stream bills per minute stored, so with recordings kept indefinitely the storage cost grows each year (roughly +$240–360/month per year of recordings at list prices). **Accepted and monitored**, with an alert threshold. An archive policy would be a future decision. | ADR-0002, §13.7 |
| Video host (C-43), later the same day | Stream was **too expensive**. **Recordings are hosted on GLIM's YouTube channel as unlisted videos** (ADR-0003). This **supersedes C-42.** Cost $0. The owner accepts: anyone with a link can watch, ads may appear, YouTube can take videos down, and there's no audio-only mode in v1. In v1, staff upload in YouTube Studio and paste the link; automatic upload comes with the Google integration. | ADR-0003, §13 |

## 10 October 2026 — UI overhaul (answers to `docs/ui-audit.md` § Questions)

The design-system handoff is `docs/ui-design-handoff.md`; the audit is `docs/ui-audit.md`.

| ID | Topic | Decision | Where |
|---|---|---|---|
| UI-Q1 | Vocabulary | **`GLOSSARY.md` wins.** UI copy and code say Lecturer, Class Meeting and Matric Number, never "teacher", unqualified "session" or "student number". The handoff's SessionCard is built as `ClassMeetingCard`, and its "Teacher" role and copy are read as Lecturer. | handoff §6.3, §9.14, §12 |
| UI-Q2 | Player | **Keep the YouTube embed for now** (ADR-0003). WP-UI-06 restyles the facade, stage, resume banner and data-saver tip. No QualityMenu, no Audio only, and no 180-day purge state (recordings are kept indefinitely). | handoff §9.16, §11.4 |
| UI-Q3 | Recording state on Class Meeting cards | **Raise an API change:** `.scratch/ui-overhaul/issues/01-class-meeting-recording-status.md`. Until it lands, the card shows only the six real states, with `NO_SHOW` as "Didn't take place". | handoff §9.14 |
| UI-Q4 | Roll call | Compose it from §9.18 AttendanceRow and the §9.20 offline queue. | WP-UI-09 |
| UI-Q5 | Course routes | Add `/courses/$offeringId` (WP-UI-05) and `/teach/$offeringId` (WP-UI-09). `/courses` and `/teach` become lists linking to them. Announcements go in the Overview tab. | handoff §11.3, §11.9 |
| UI-Q6 | Lecturer home | A Lecturer's `/` is Lecturer Today (§11.7). | WP-UI-04/09 |
| UI-Q7 | Admissions and registration screens | Compose them from §9/§10 in WP-UI-11 ("composed, not specified"). INV-15 is unchanged. | WP-UI-11 |
| UI-Q8 | Transcripts | **Merge** the transcripts pages into the results pages: the student's into `/results` (§11.6), the Registrar's requests into the semester results page (§11.10). The old paths redirect. | WP-UI-08, WP-UI-10 |
| UI-Q9 | Data the API doesn't return | **Skip for now.** No UI is built for it; it is documented for future work in `.scratch/ui-overhaul/issues/02-ui-data-gaps.md`. | — |
| UI-Q10 | Radix UI | **Install it** for Dialog/Sheet, DropdownMenu, Tabs, RadioGroup, Checkbox, Switch and Tooltip. | handoff §3.1 |
| UI-Q11 | Google sign-in button | **A design exception is approved for the four-colour "G" mark.** Checked against Google's *Sign in with Google* branding guidelines: the standard G must sit on white and cannot be recoloured, and the button may only use Google's light, dark or neutral themes, not a brand fill. So the brand-green `primary` button in §11.1 is **not** acceptable. "Continue with Google" stays the first, full-width button, but uses Google's light theme (white fill, `#747775` 1 px stroke, `#1F1F1F` text) in light mode and its dark theme (`#131314` fill, `#8E918F` stroke, `#E3E3E3` text) in dark mode, with the G on white. Those values are design exceptions too. | handoff §11.1 |
| UI-Q12 | Collapsible section | Add a "Disclosure" component to §9 (restyled native `<details>`). | WP-UI-03 |
| UI-Q13 | Product name | The name stays admin-editable (`GET /institution`) and appears everywhere a name is needed (top bar, rail, sign-in, page `<title>`, transcripts). There is no hard-coded "GLIM LMS" wordmark; this answers UQ-2. | WP-UI-04/05 |
| UI-Q14 | Budget tooling | WP-UI-01 extends `budget-check.mjs` to report brotli and gzip and adds a Playwright check that the first screen downloads no fonts and no images except the crest. Signed-in Lighthouse runs come in WP-UI-12. | handoff §14 |
| UI-Q15 | Spec references | The handoff's `SCHOOL_LMS_BUILD_SPEC.md` v2.1 references mean the equivalent sections of `docs/TRD.md` v3.0 (frontend is §18). | — |
| UI-Q16 | Tailwind's default palette | WP-UI-01 adds the tokens alongside Tailwind's defaults, with the raw-value lint as a warning. WP-UI-12 removes the defaults and makes the lint an error. | handoff §15.1 |

## Defaults applied — awaiting owner confirmation

These came up while writing the spec; none was put to the owner yet. They're built as defaults that are easy to change.

| ID | Item | Default | Why it matters |
|---|---|---|---|
| D-01 | Matric Number when a Certificate graduate is admitted to the Diploma | A **new** Matric Number per admission (`GLIM/DIP/2027/0001`) | Decides whether a person has one Matric Number or several |
| D-02 | Good-standing threshold | CGPA ≥ 1.00 = good standing; no probation band | Affects the standing shown to the Registrar |
| D-03 | Year 1 → Year 2 progression | Everyone advances when the new Academic Session opens. Retakes of failed compulsory courses are registered manually by the Academic Admin. | Decides whether progression needs rules |
| D-04 | Existing students part-way through a programme | Import them, with their past results, from CSV | Without it, current students' CGPA and transcripts are incomplete |
| D-05 | Lecturers' rights over videos | Lecturers can add YouTube links, publish/unpublish and edit titles for their own courses. Only the System Admin can delete, restore or replace. | Splits video management between roles |
| D-06 | Applications started but never submitted | Deleted 12 months after the last edit | Data protection |
| D-07 | Keep Google Drive originals (reverses the earlier "Drive cleanup: yes") | Keep Meet recordings in Drive (`DRIVE_CLEANUP_MODE=NONE`), because YouTube can take videos down and the Drive file is the only reliable original | Recordings are kept indefinitely |
| D-08 | Recording notice wording | The notice says recordings are published on GLIM's YouTube channel as unlisted videos that anyone with the link can view. Lecturers keep the camera on themselves and the slides where possible. | Students' faces and voices go onto YouTube |
| D-09 | Audio-only | None in v1 (YouTube has no audio-only embed; a "choose 144p" tip instead). Optional later: an ~18 MB/hour audio file made from the Drive original. | Low-bandwidth students |
| D-UI-01 | Main navigation for every role (handoff §6.3 covers only three; UI-Q6 answered the Lecturer home) | One area per role held, merged in this order: Home · Courses (student) · Results (student, graduate) · Application (applicant) · Teaching (Lecturer) · Admissions · Academic · Results (Registrar, Academic Admin) · People · Settings · Ops (System Admin) · Profile. The bottom bar shows up to five; beyond that, four plus **More** (a sheet with the rest). The desktop rail shows all. Areas with several pages (Academic: Calendar, Offerings, Lecturers, Imports…) show their pages as a row of links on each. Notifications and the account menu (Profile, Sign out) sit top right. A Schedule item and the profile role switcher arrive with their screens (WP-UI-11). Code: `apps/web/src/components/app/nav.ts`. | Decides how staff with many roles reach ~25 pages on a phone |

## Open

| ID | Item | Owner |
|---|---|---|
| Q-02 | Spike S-01: does Meet report a stable ID for Gmail participants? Until it passes, online attendance runs in review mode. | System Admin (TRD Appendix B.1) |
| S-Y1 | YouTube checks: link-check behaviour for unlisted/private/deleted videos, ads on GLIM's channel, which Studio role lets Lecturers upload, playback on target phones, API audit path (TRD Appendix B) | Build team + System Admin |
| Q-17 | Total Class Meetings per day (sizing only; default ≤ 10 of ≤ 90 min) | Owner |
