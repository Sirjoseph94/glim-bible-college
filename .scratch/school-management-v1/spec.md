# Spec: GLIM school management system v1, without the Google Meet/Drive integration

Status: ready-for-agent

Source documents: `docs/TRD.md` (v3.0), `GLOSSARY.md`, `docs/decisions.md`, `docs/adr/0001-single-institution.md`, `docs/adr/0002-app-platform-and-managed-video.md`, `docs/adr/0003-video-delivery-cost.md`. Where this spec and the TRD differ, **this spec wins for this slice**. Every difference is listed under Implementation Decisions → "Interim behaviour without the Google integration".

## Problem Statement

GLIM Online Bible College runs admissions on a paper/PDF form, and keeps student records, class schedules, attendance, recordings, grades and results across separate tools and spreadsheets. As a result:
- Applicants can't apply online or track their application.
- Admissions staff can't review, decide on or report on applications in one place.
- Lecturers running hybrid classes (some students in the room, some online) have no single place to schedule classes, take attendance, share materials and recordings, set assignments and exams, and enter grades.
- Students, many on slow and expensive mobile data, have no low-bandwidth place to see their timetable in their own timezone, choose electives, rewatch lectures, submit work, and see results.
- The Registrar can't compute GPA/CGPA, classify awards (Distinction / Credit / Pass) or issue verifiable transcripts without manual work.

The automatic Google Meet integration (creating Meet spaces, syncing members, reading Meet attendance, pulling recordings out of Drive) isn't ready to build yet, but the college needs everything else working first.

## Solution

A single web application for GLIM, running on DigitalOcean App Platform, that handles:

- **Admissions:** applicants sign in with Google, fill in the online version of the application form (saved as they go), submit, and accept an offer. Acceptance makes them a student with a Matric Number.
- **Academic setup:** programmes (1-year Certificate, 2-year Diploma), curricula, courses, Academic Sessions, semesters, Rooms, Course Offerings and Lecturer assignments.
- **Registration:** compulsory courses are registered automatically each semester, and students choose their electives.
- **Hybrid Class Meetings:**
  - Each meeting has a Room and an online link **that the Lecturer pastes in**.
  - Neither the Lecturer nor the Room can be double-booked.
  - The Lecturer takes **roll call** for both in-room and online students.
- **Recordings:** uploaded by Lecturers or the System Admin to **GLIM's YouTube channel as unlisted videos**, then linked into the app, which shows them only to enrolled students, with resume and a low-data (144p) tip.
- **Learning and assessment:** materials, announcements, assignments, quizzes, and hybrid exams (paper scores entered by hand + timed online exams) feeding one gradebook.
- **Results:** course results, semester GPA/CGPA on the NUC 5-point scale, Registrar approval and publication, award classes, and tamper-evident transcripts with a public verification page.
- **Supporting functions:** notifications by email and in-app, CSV imports for current students and their past results, an audit trail, and an ops page for the System Admin.

The Google integration slots in later behind the `LiveProvider` port, replacing the pasted links and manual online attendance without changing the student-facing flows.

## User Stories

### Applicants

1. As an Applicant, I want to read about the Certificate and Diploma programmes and the intake dates before starting, so that I know what I'm applying for and the deadline.
2. As an Applicant, I want to start my application by signing in with my Google account, so that I don't have to create and remember another password.
3. As an Applicant without a Google account, I want a link to create one, so that I can still apply.
4. As an Applicant, I want to choose the Certificate or the Diploma, so that I apply for the right programme.
5. As an Applicant, I want to choose On-campus or Online study mode, so that the college knows how I plan to attend.
6. As an Applicant, I want the form split into the same sections as the paper form, so that it's familiar and manageable on a phone.
7. As an Applicant, I want my answers saved automatically as I type, so that I don't lose work on a poor connection.
8. As an Applicant, I want to leave and come back later to finish, so that I can gather information like my pastor's phone number.
9. As an Applicant, I want to see "Saved" or "Offline — will retry", so that I trust my answers are kept.
10. As an Applicant, I want my email filled in from my Google account but editable, so that correspondence goes where I want.
11. As an Applicant, I want to give WhatsApp phone numbers, so that the college can reach me the way I prefer later.
12. As an Applicant, I want to upload a passport photo from my phone, with it shrunk automatically, so that the upload works on slow data.
13. As an Applicant, I want to read the Statement of Faith from a link inside the declaration, so that I can confirm I've read it.
14. As an Applicant, I want to sign the declaration by typing my full name and ticking a box, so that I don't need to print and scan anything.
15. As an Applicant, I want to give data-processing consent separately from the declaration, so that I know what I'm agreeing to.
16. As an Applicant, I want to enter a referral code if someone referred me, so that they're credited.
17. As an Applicant, I want a review page listing any missing required fields, so that I can fix them before submitting.
18. As an Applicant, I want an Application Reference No and an email receipt when I submit, so that I have proof of submission.
19. As an Applicant, I want to be told if the intake is closed, so that I don't fill in a form I can't submit.
20. As an Applicant, I want to see my application's status (submitted, under review, admitted, rejected), so that I know where I stand.
21. As an Applicant, I want to withdraw my application, so that I can change my mind.
22. As an Applicant who has been admitted, I want an email and an offer page with a countdown to the 21-day deadline, so that I don't miss it.
23. As an Applicant who has been admitted, I want reminders 7 days and 2 days before my offer expires, so that I don't forget.
24. As an Applicant, I want to accept my offer with one action, and immediately see my Matric Number and next steps, so that I know I'm enrolled.
25. As an Applicant whose offer lapsed, I want to be told it lapsed, so that I can contact admissions to reopen it.
26. As an Applicant under 18, I want to be told I'm not eligible, so that I don't waste time.

### Admissions Officers

27. As an Admissions Officer, I want to create the yearly intake with its opening and closing dates and its Academic Session, so that applications are collected for the right year.
28. As an Admissions Officer, I want the intake to open and close automatically on its dates, so that I don't have to remember.
29. As an Admissions Officer, I want a queue of applications I can filter by status, programme and study mode, and search by name or reference, so that I can work through them.
30. As an Admissions Officer, I want to open an application and see every section, including spiritual background, so that I can make an informed decision.
31. As an Admissions Officer, I want opening an application to mark it Under Review, so that colleagues see it's being handled.
32. As an Admissions Officer, I want to admit or reject an application with an internal note, so that the decision and reasoning are recorded.
33. As an Admissions Officer, I want rejection emails to use neutral wording and never include my internal note, so that applicants are treated respectfully.
34. As an Admissions Officer, I want to reopen a lapsed offer with a new deadline and a reason, so that genuine late cases can still enroll.
35. As an Admissions Officer, I want to record interview notes on an application, so that context is kept without a separate system.
36. As an Admissions Officer, I want to see applications whose referral code didn't match anyone, so that I can follow up.
37. As an Admissions Officer, I want an intake report (counts by status, programme, study mode, country, how they heard about us), so that I can plan and report to leadership.
38. As an Admissions Officer, I want a referral report showing each referrer and their applicants' outcomes, so that referrals can be recognised.
39. As an Admissions Officer, I want to export applications, optionally including sensitive answers, so that I can work offline when needed.

### Academic Admin

40. As an Academic Admin, I want to set up the Certificate and Diploma programmes with their length and Levels, so that the structure matches GLIM.
41. As an Academic Admin, I want to define each programme's curriculum (courses, credits, Level, semester, compulsory or elective), so that registration knows what each student takes.
42. As an Academic Admin, I want to clone a curriculum into a new version instead of editing one that's in use, so that existing students keep the version they started on.
43. As an Academic Admin, I want to set the minimum elective credits a programme requires, so that awards check the requirement.
44. As an Academic Admin, I want to create Academic Sessions (September–June) with two semesters and their exam periods, so that the calendar is right.
45. As an Academic Admin, I want to manage Rooms, so that Class Meetings can be booked into them.
46. As an Academic Admin, I want to create Course Offerings for a semester and assign Lecturers (one Primary, plus co-lecturers, assistants or guest lecturers), so that teaching is staffed.
47. As an Academic Admin, I want publishing an offering to require a Primary Lecturer, so that no course runs unstaffed.
48. As an Academic Admin, I want opening a semester's registration to register every active student for their compulsory courses automatically, so that I don't register students one by one.
49. As an Academic Admin, I want to be warned when a compulsory course has no published offering, so that I can fix gaps before classes start.
50. As an Academic Admin, I want to register a student manually (e.g. to retake a failed course) with a reason, so that exceptions are possible and recorded.
51. As an Academic Admin, I want to withdraw a student from a course after the add/drop deadline, with a reason, so that late changes are controlled.
52. As an Academic Admin, I want Year 1 Diploma students moved to Year 2 when the new Academic Session starts, so that progression is automatic.
53. As an Academic Admin, I want to close a semester and have offerings and enrollments completed automatically, so that results can be computed.
54. As an Academic Admin, I want to import current students (with their existing Matric Numbers), Lecturers and enrollments from CSV, with a dry run first, so that onboarding is fast and safe.
55. As an Academic Admin, I want to import students' past course results from CSV, so that current students' CGPA and transcripts are complete.
56. As an Academic Admin, I want a downloadable error file when import rows fail, so that I can fix and re-run only those rows.
57. As an Academic Admin, I want attendance reports per Course Offering (student × meeting, with in-person/online mode), so that I can follow up on absence.

### Lecturers

58. As a Lecturer, I want to see the Course Offerings I'm assigned to, so that I know what I teach this semester.
59. As a Lecturer, I want to schedule a single Class Meeting or a weekly series with a Room, so that the timetable is set once.
60. As a Lecturer, I want to be stopped from double-booking myself or a Room, so that clashes are caught before they happen.
61. As a Lecturer, I want to be warned when enrolled students have clashing meetings, so that I can avoid them.
62. As a Lecturer, I want to paste the online meeting link for each Class Meeting (or once for a series), so that online students can join.
63. As a Lecturer, I want to reschedule or cancel a meeting with a reason, and have students notified, so that changes are communicated.
64. As a Lecturer, I want a phone-friendly roll call listing my students (On-campus first, with photos), so that I can take attendance quickly in the room.
65. As a Lecturer, I want to mark each student Present in the room, Present online, Late or Absent, so that hybrid attendance is recorded in one place.
66. As a Lecturer, I want "mark all on-campus present", so that roll call is fast for a full room.
67. As a Lecturer, I want roll call to save even on flaky Wi-Fi and retry automatically, so that marks aren't lost.
68. As a Lecturer, I want to correct roll call for up to 7 days after the class, so that mistakes can be fixed.
69. As a Lecturer, I want to override a student's attendance (e.g. Excused) with a reason, so that genuine exceptions are recorded.
70. As a Lecturer, I want to publish materials (files, links, text) with optional scheduled release, so that students get resources at the right time.
71. As a Lecturer, I want to post announcements to my offering, so that students are informed.
72. As a Lecturer, I want to add a lecture recording to my offering by pasting its YouTube link (uploaded unlisted to GLIM's channel), so that students can rewatch it.
73. As a Lecturer, I want to edit a recording's title and description, reorder recordings, and publish or unpublish them, so that the list stays tidy.
74. As a Lecturer, I want to create assignments with due dates, cutoffs and late rules, so that coursework is managed.
75. As a Lecturer, I want to build quizzes from a course question bank, with time limits and attempt rules, so that I can assess understanding.
76. As a Lecturer, I want to create an exam that online students take as a timed online exam, while I enter paper scores for in-room students into the same gradebook column, so that hybrid exams are fair and simple.
77. As a Lecturer, I want to let an individual On-campus student sit the online exam, so that I can handle exceptions.
78. As a Lecturer, I want to grade submissions and essay answers with feedback, so that students learn from them.
79. As a Lecturer, I want to enter or import scores by CSV, so that paper exam marking is quick.
80. As a Lecturer, I want to release grades per assessment when ready, so that students only see final marks.
81. As a Primary Lecturer, I want to finalize course results, which checks that weights total 100, so that results are correct and locked.
82. As a Lecturer, I want every grade change recorded with who and why, so that disputes can be resolved.

### Students

83. As a Student, I want my home page to show today's and upcoming Class Meetings in my own timezone, with Lagos time alongside, so that I don't miss classes.
84. As a Student, I want each Class Meeting card to show the Room and the online link, so that I can attend whichever way suits me that day.
85. As a Student, I want the online link to appear only around class time, so that I join the right class.
86. As a Student, I want to see that a class is recorded before joining, so that I know.
87. As a Student, I want my compulsory courses already registered each semester, so that registration is simple.
88. As a Student, I want to choose electives for my Level and semester before the add/drop deadline, so that I can follow my interests.
89. As a Student, I want to drop an elective before the deadline, so that I can change my mind.
90. As a Student, I want the recording page to load only a small thumbnail until I tap play, so that I don't spend data on videos I don't watch.
91. As a Student, I want a tip showing how to switch YouTube to 144p (about 40 MB an hour), so that I can follow a lecture on very little data.
92. As a Student, I want to see roughly how much data a video will use, so that I can budget my data.
93. As a Student, I want recordings to resume where I stopped, so that I don't have to search.
94. As a Student, I want to keep access to recordings of courses I've completed until I finish my programme, so that I can revise.
95. As a Student, I want to download materials and submit assignments as files or text, so that I can complete coursework.
96. As a Student, I want quiz and exam answers saved as I go, and submitted automatically when time runs out, so that a dropped connection doesn't cost me.
97. As a Student, I want to see my released grades and feedback, so that I know how I'm doing.
98. As a Student, I want to see my course results as soon as the Lecturer finalizes them, with my GPA/CGPA marked Provisional until approved, so that I get timely but honest information.
99. As a Student, I want to see my attendance record, so that I know if I'm falling behind.
100. As a Student, I want to request an unofficial transcript instantly and an official one for a named recipient, so that I can apply elsewhere.
101. As a Student, I want to download my issued transcripts, so that I can share them.
102. As a Student, I want my personal referral code on my profile, so that I can refer friends.
103. As a Student, I want to set my timezone and notification preferences, so that the app fits me.
104. As a Student, I want to export my personal data, so that I can exercise my data rights.

### Registrar

105. As a Registrar, I want to compute semester results for a programme or cohort, so that GPA/CGPA are produced from finalized course results.
106. As a Registrar, I want to approve and then publish semester results in bulk, so that provisional results become official.
107. As a Registrar, I want to reopen a course result with a reason, which moves dependent semester results back to draft and supersedes affected transcripts, so that corrections are safe.
108. As a Registrar, I want a results broadsheet (credits, GPA, CGPA, standing) as CSV, so that I can present to the academic board.
109. As a Registrar, I want to propose an award for a student, with a checklist of unmet requirements, so that I can see who qualifies.
110. As a Registrar, I want the award class (Distinction, Credit, Pass, or no award) computed from final CGPA, so that classification is consistent.
111. As a Registrar, I want to confirm an award, which assigns a certificate number and graduates the student, so that completion is recorded.
112. As a Registrar, I want to approve or reject official transcript requests and issue transcripts with a serial number, QR code and hash, so that documents are verifiable.
113. As a Registrar, I want to revoke a transcript with a reason, so that wrongly issued documents are invalidated.
114. As a Registrar, I want to manage grading schemes and award-class bands per programme, with used schemes locked, so that history is never altered.

### Verifiers (public)

115. As an employer or another school, I want to scan a transcript's QR code and see whether it's valid, revoked or superseded, with its hash, so that I can trust the document.

### System Admin

116. As the System Admin, I want to manage users and assign staff roles (System Admin, Admissions Officer, Registrar, Academic Admin), so that people have the right access.
117. As the System Admin, I want to set the institution's name, timezone, staff email domains and Statement of Faith link, so that the system reflects GLIM.
118. As the System Admin, I want to manage policies (attendance thresholds, notification rules, admissions texts) with every version kept, so that changes are traceable.
119. As the System Admin, I want a video management screen across all offerings, so that I can see and manage every recording.
120. As the System Admin, I want to replace a video's YouTube link without losing its place in the course, so that mistakes can be fixed.
121. As the System Admin, I want a link from each video to its YouTube Studio page, so that I can download or manage it there.
122. As the System Admin, I want to delete a video and be able to restore it for 7 days, so that accidental deletions are recoverable.
123. As the System Admin, I want an ops page showing failed jobs, videos that YouTube no longer serves, and email bounces, with replay, so that I can fix problems without a developer.
124. As the System Admin, I want to read the audit log, so that I can investigate who changed what.
125. As the System Admin, I want emails to stop going to addresses that bounce, so that our sender reputation stays healthy.
126. As the System Admin, I want links to videos from outside GLIM's YouTube channel to be rejected, so that courses only show our own content.
127. As a Lecturer, I want to be told when one of my linked videos becomes private, deleted or taken down on YouTube, so that I can replace it.

### Everyone

128. As any user, I want the app to load fast on a slow mobile connection, so that I can use it on my data plan.
129. As any staff member, I want to sign in with Google, or with email and password if needed, so that I can access my work.
130. As any user, I want critical notices (cancellations, decisions, results published) by email and everything else in-app plus a daily digest, so that I'm informed without being spammed.

## Implementation Decisions

### Scope boundary: Google integration deferred

The following parts of the TRD are **not built** in this slice:
- §11.1–11.3 and §11.5–11.8: Meet space provisioning, host accounts, domain-wide delegation, member sync, Workspace Events/Pub/Sub, reconciliation and the quota limiter
- §12.4: the Meet participant matching ladder, `conference.sync` and online-evidence attendance
- §13.3: Meet recording discovery, Drive ingest and Drive cleanup

**Google sign-in (OIDC) is kept.** It is plain OAuth with no Workspace setup.

The `LiveProvider` port is **defined but not implemented**. Only its interface ships, so that the later integration doesn't change domain code.

### Interim behaviour without the Google integration (differs from the TRD)

- **Online link:**
  - A Class Meeting (and a series, as the default for its occurrences) has an optional **`online_link`** that a Lecturer or Academic Admin enters. It must be an `https://meet.google.com/...` URL; other URLs are rejected so that links stay predictable.
  - `provider_status` is unused. Meetings are created ready.
  - The join endpoint stays **database-only**: it authorizes, checks the join window, logs the attempt, and returns the stored link (or `ONLINE_LINK_NOT_SET`).
  - The "Google account linked before joining" check is **not enforced** in this slice; students wait in the Meet lobby and the Lecturer admits them.
- **Roll call covers online students too:**
  - A roll-call mark carries a **mode**: `IN_PERSON` or `ONLINE`.
  - `computeAttendance` treats an `ONLINE` mark as manual online evidence: `PRESENT`, mode `ONLINE`, `ratio_bp=10000`, `late` from the mark. An `IN_PERSON` mark behaves as in the TRD.
  - With no conference data, attendance is computed from roll call alone. The short-conference review flag and the unmatched-participant review aren't used.
  - When the integration lands, Meet evidence joins the same pure function, so the online marks become an override path rather than a different system.
- **Class Meeting lifecycle:**
  - The state machine keeps `SCHEDULED → OPEN → LIVE → ENDED`, `CANCELLED` and `NO_SHOW`.
  - LIVE and ENDED are driven by the Lecturer's **Start** and **End** actions plus the `meeting-tick` cron. The tick ends a LIVE meeting at `scheduled_end + maxOverrun`, and a meeting with no Start and no roll call at `scheduled_end + joinAfter` becomes NO_SHOW.
  - Finalization runs when the meeting is ended: it computes attendance and locks after `lockAfterDays`.
- **Recordings: YouTube, unlisted (C-43, ADR-0003):**
  - There is no automatic Meet recording ingest.
  - Lecturers (own offerings) and the System Admin upload to **GLIM's YouTube channel** in YouTube Studio (channel default: unlisted) and **paste the link** into the app, optionally linking it to a Class Meeting. `videos.origin` is `LINK` for everything in this slice.
  - The `VideoHost` port is implemented by `YouTubeLinkHost`, which parses the URL and checks the video through YouTube's public **oEmbed** endpoint. This is not a Google API integration: there are no keys and no accounts. The check rejects invalid, private and deleted videos, and videos from channels not listed in `settings.youtube_channel_urls`. `FakeVideoHost` scripts these outcomes in tests.
  - A **daily availability check** (and a manual recheck) marks videos `UNAVAILABLE` when YouTube stops serving them, hides them from students, and notifies staff.
  - **Playback:** `/play` authorizes, then returns the YouTube id, a `youtube-nocookie.com` embed URL, the thumbnail and the resume position. The web player shows a thumbnail facade, loads the YouTube IFrame player only on tap, reports progress through `getCurrentTime()`, and shows the 144p data-saver tip.
  - **No audio-only, no download endpoint, no YouTube API calls** in this slice. Replace means swapping the link. Delete hides the video in the app (7-day restore), then reminds the System Admin to delete it in YouTube Studio.
  - The `recordings` table, the Drive cleanup job and automatic upload belong to the Google integration slice.
  - **Accepted exposure:** anyone with an unlisted link can watch it. The app's access rule only controls what the app shows (TRD INV-10).

### Architecture (per ADR-0001, ADR-0002 and TRD §4–5)

- **Single institution:** no tenant key, no row-level security, and a single-row settings table.
- **One App Platform app:**
  - an `api` service (REST API + the built single-page app, same origin)
  - one `worker` running every job role
  - a pre-deploy `migrate` job
- **Data and messaging:** DO Managed PostgreSQL 18 (transaction-mode pool + direct connection), DO Spaces for files, SendGrid for email.
- **Libraries and transport:** pg-boss for all background work, enqueued **in the same transaction** as the change that needs it (no Redis, no outbox). Drizzle ORM with hand-written SQL migrations for exclusion constraints, triggers, the virtual column and SQL functions. REST + Zod contracts shared between api, worker and web, with OpenAPI generated.

### Modules (application layer; each owns its tables)

| Module | Responsibility |
|---|---|
| **identity** | Settings, users, Google OIDC (intents: sign-in, apply, link), local password for staff and imported students, invites/resets, auth sessions, CSRF, lockout, policies, viewer timezone, referral codes on users |
| **authorization** | Permission matrix as data (`matrix.json`), the `AuthorizationService` decision algorithm (staff role → lecturer assignment capability → student entitlement → applicant ownership), the `v_offering_access` read model, and the `VisibleOfferings` SQL helper. Unknown or invisible resources return 404. |
| **academic** | Programmes, curricula (versioned, clone), courses, curriculum placements, Academic Sessions, semesters (lifecycle, exam dates), Rooms, Course Offerings |
| **admissions** | Intakes, applications (section fields mirroring the paper form), the application state machine, reference-number sequence, decisions, offers, the expiry sweep, acceptance orchestration, purge, referral matching, admissions reports and export |
| **enrollment** | Students, the Matric Number sequence, programme/semester/course enrollments, open-registration (compulsory auto-registration), elective selection, manual registration, drop/withdraw, progression |
| **lecturing** | Lecturers, lecturer assignments and their capability table |
| **scheduling** | Class Meeting series expansion (rrule, institution timezone), lecturer slots with the overlap exclusion constraint, conflict checking incl. student-clash warnings |
| **class-meeting** | Class Meetings (incl. `room_id`, interim `online_link`), state machine, join/start/end, the room double-booking exclusion constraint |
| **attendance** | Roll-call marks (with mode), the pure `computeAttendance`, attendance records (computed fields + audited override, virtual `status` never written), finalization, reports |
| **video** | Videos (`LINK` origin), add-by-link with oEmbed checks and the channel allowlist, daily availability check + recheck, publish/unpublish/metadata/reorder, replace link, delete with 7-day restore + YouTube Studio reminder, playback authorization returning the embed data, progress |
| **content** | Files (presigned Spaces upload/download with per-purpose caps), materials, announcements |
| **assessment** | Assessments (gradebook columns), assignments and submissions, question bank, quizzes and online exams (frozen question snapshot, server timer, auto-expire, `eligible_study_mode`), grades with `source` (manual/quiz/submission/import), grade history, release, CSV grade import |
| **results** | Grading schemes (NUC 5 bands + award classes, locked once used), pure functions (final percentage, banding, semester result, CGPA with repeat policy, standing, award class), course results (finalize/reopen, incl. imported legacy results), semester results (compute/approve/publish), awards (propose/confirm, certificate numbers) |
| **transcripts** | Requests, issue (canonical snapshot + SHA-256, serial, verification code), PDF render job, public verify function, revoke/supersede, emailing to recipients |
| **notifications** | In-app notifications, preferences, critical-email policy, daily digest, recipient-timezone rendering, SendGrid signed event webhook → suppression |
| **imports** | Dry-run/commit CSV imports for students, lecturers, course enrollments and legacy course results; resumable; error CSV |
| **audit** | Append-only audit log written in the same transaction as the audited change |
| **ops** | Failure view (failed jobs/dead letters, unavailable videos, email bounces), replay, YouTube link-check status, pg-boss dashboard for the System Admin |

### Ports (deep seams for external services)

| Port | Implementations in this slice |
|---|---|
| `VideoHost` (TRD §13.1 interface) | `FakeVideoHost` + `YouTubeLinkHost` (oEmbed). `YouTubeApiHost` belongs to the integration slice. |
| `ObjectStorage` | S3-compatible adapter for Spaces and MinIO |
| `Mailer` | SendGrid adapter; SMTP adapter for Mailpit in development |
| `Clock` | Injected everywhere domain code reads time |
| `LiveProvider` | **Interface only** |

### Schema

Follow TRD §6 for migration groups M01, M02, M04 (videos and playback progress only), M05, M06, M07 and M08. For M03, include:
- `class_meeting_series` and `class_meetings`
- `meeting_lecturer_slots` and `meeting_join_log`
- `roll_call_marks` and `attendance_records`
- the `provider_events` inbox, used for SendGrid webhooks

Interim changes:
- **`class_meetings`:** add a nullable `online_link`. Keep the provider columns, nullable and unused.
- **`class_meeting_series`:** add a nullable default `online_link`.
- **`roll_call_marks`:** add `mode` (`IN_PERSON`, `ONLINE`) and keep `present`/`late`.
- **Deferred tables** (created by the integration slice): `provider_host_accounts`, `provider_subscriptions`, `conference_records`, `provider_participant_sessions`, `recordings`.
- **`videos.recording_id`:** created later, with the `recordings` table.

Hand-written SQL migrations cover:
- the lecturer-overlap and room double-booking exclusion constraints
- the course-enrollment consistency trigger
- the append-only audit trigger
- the transcript immutability trigger
- the virtual attendance `status` column
- the public `verify_transcript` function

### Key behaviours to preserve from the TRD

- **Application submit, admission decision and offer acceptance are idempotent** (`Idempotency-Key`).
- **Acceptance is one transaction.** It creates or reuses the student record (copying only the allowed fields), allocates a gap-free Matric Number `GLIM/{CERT|DIP}/{YYYY}/{NNNN}`, gets or creates the cohort, creates the programme enrollment, registers compulsory courses if registration is already open, and ensures a referral code.
- **Sensitive data:** spiritual-background answers are returned only to holders of `admissions:application:read-sensitive`, and only on the application detail endpoint. They never appear in lists, notifications, logs or audit metadata.
- **Retention:** rejected, lapsed and withdrawn applications, and drafts not edited for 12 months, are hard-deleted with their photo.
- **Recording access:** students may watch recordings for course enrollments that are `ENROLLED` or `COMPLETED` **while the owning programme enrollment is ACTIVE**. Graduation or withdrawal ends access.
- **Exact arithmetic:** grades and GPA use integer arithmetic with half-up rounding. Results are visible to students on finalization and labelled *Provisional* until semester approval and publication. Official transcripts require approved semesters.
- **Display times:** all times are shown in the viewer's timezone, with Lagos time alongside when they differ.
- **Low-bandwidth budgets** are enforced in CI (initial JS ≤ 170 KB, route chunks ≤ 60 KB, LCP ≤ 4 s on slow 4G).

### API

Follow the TRD §16 catalogue for the included areas, with these interim changes:
- `PATCH /class-meetings/:id` and series creation accept `onlineLink`.
- `POST /class-meetings/:id/join` returns `{meetingId, state, onlineLink, room, window}`, or the error `ONLINE_LINK_NOT_SET`.
- `PUT /class-meetings/:id/roll-call` accepts `{marks:[{studentId, present, late, mode}]}` with `If-Match`.
- The reprovision, participant and participant-match endpoints, and the Google admin integration endpoints, are not built.
- Add `ONLINE_LINK_NOT_SET` and `ONLINE_LINK_INVALID` to the error codes.

### Spec documents

When this slice merges, `docs/TRD.md` §2.3 gains a row noting the interim online-link and roll-call-mode behaviour, and pointing to this spec.

## Testing Decisions

**What makes a good test here:** it exercises external behaviour through a public seam and asserts on what a user or another module could observe: API responses, stored state as read back through the API, emails sent to the fake mailer, jobs that ran. It doesn't assert on internal calls, private functions or SQL text. Tests use real PostgreSQL 18, because many rules live in the database (exclusion constraints, unique indexes, triggers).

**Seam 1 (primary): the HTTP API.**
- Each test boots the API against a fresh Postgres 18 (Testcontainers) and MinIO, with `FakeVideoHost`, an in-memory `Mailer` and a controllable `Clock`. It acts as persona fixtures.
- A test helper **drains pg-boss queues** so that background work (open-registration, offer sweep, notifications, video availability check, results compute, transcript generation, purge) runs to completion inside the test.
- This seam covers:
  - every authorization deny path, generated from `matrix.json` over the personas (System Admin, Admissions Officer, Registrar, Academic Admin, Lecturers with each assignment role, students in each enrollment state including completed-active and graduated, applicants)
  - the full admissions journey (draft → submit → review → admit/reject → accept/lapse/reopen → purge)
  - registration (compulsory auto-registration, electives within the window, manual retake, progression)
  - Room and Lecturer double-booking (concurrent creates, where the second fails)
  - join window and online-link behaviour
  - roll call with both modes, overrides surviving recompute, and the attendance lock
  - add YouTube link (invalid/private/deleted/other-channel rejected) → publish → play (entitled only) → progress → replace link → unavailable detection → delete/restore/purge, with access ending at graduation
  - assignments, quizzes, online exams with timer expiry, and mixed manual/online exam scores
  - finalize → compute → approve → publish → award → transcript issue → public verify → revoke, plus reopen superseding transcripts
  - CSV imports, including legacy results counting toward CGPA
  - INV-15: sensitive answers absent from every list, notification, audit row and log line

**Seam 2: pure domain functions.**
- These are `computeAttendance`, `computeFinalPercent`, `bandFor`, `computeSemesterResult` (including repeat policies) and `classifyAward`.
- They're tested against the TRD Appendix C golden vectors, with the attendance vectors adjusted for interim online marks (V11–V14 plus an online-mark equivalent of V1), and property tests for half-up rounding, band boundaries, award-class boundaries (4.50/4.49, 3.00/2.99, 1.00/0.99) and zero-credit semesters.

**Contract tests** for `FakeVideoHost` and `YouTubeLinkHost` share one suite (URL parsing table plus recorded oEmbed responses), so the fake can't drift from YouTube's behaviour.

**Frontend:**
- Playwright, against the composed stack with fakes, on a mobile viewport:
  - apply → submit → admit → accept
  - elective registration
  - joining with the pasted link
  - roll call with offline retry
  - watching (thumbnail facade → stubbed YouTube player → resume) on a mobile viewport
  - online exam timer expiry
  - results and transcript request → verify
- The bundle-budget check, Lighthouse CI and axe accessibility checks run in CI.

**Prior art:** none in the repo yet; this slice establishes the patterns. Follow TRD §21 for the scenario list and §0.3 for the definition of done.

## Out of Scope

- **Google Workspace integration:** Meet space creation, host accounts, domain-wide delegation, member sync, Workspace Events/Pub/Sub, Meet attendance ingestion and participant matching, automatic recording ingest from Drive, Drive cleanup, and the Google admin integration wizard. **Google sign-in is in scope.**
- Fees, payments, invoices, and application fees.
- Hostel, library, ministry practicum, chapel attendance, HR and payroll.
- SMS, WhatsApp and push notifications.
- Proctoring, video trimming, offline video download for students, audio-only playback, speech transcripts and virus scanning.
- YouTube Data API uploads, metadata sync and deletion: these come with the Google integration slice.
- Multi-institution use, SAML and native mobile apps.

## Further Notes

- **Video is YouTube, unlisted** (C-43, ADR-0003, decided 7 Oct 2026; replaces Cloudflare Stream on cost). Spike S-Y1 (TRD Appendix B) confirms oEmbed behaviour per visibility, the channel-URL format, ads, the Studio upload role for Lecturers, and embed behaviour on target phones. Nothing in this slice is blocked on it.
- **Before launch:** the System Admin creates the channel with unlisted upload defaults (TRD Appendix A.4), and the recording notice states that recordings are on YouTube as unlisted videos (D-08).
- **Defaults awaiting owner confirmation** (`docs/decisions.md` D-01 to D-09) are built as written but kept easy to change:
  - a new Matric Number per admission
  - good standing at CGPA ≥ 1.00
  - automatic Year 1 → Year 2 progression
  - the legacy results import
  - the split of video rights between Lecturers and the System Admin
  - draft applications purged after 12 months
  - keeping Drive originals (integration slice), the recording-notice wording, and no audio-only in v1
- **Follow-up slice: Google Meet integration.**
  - Implements the `LiveProvider` port and replaces the pasted `online_link` with provisioned spaces.
  - Adds Meet-evidence attendance into the same `computeAttendance` function, with ONLINE roll-call marks remaining as a manual path.
  - Adds automatic recording ingest.
  - Re-enables the "Google account linked before joining" check.
  - Its prerequisites are spike S-01 (run by the System Admin, TRD Appendix B.1) and the Google Cloud setup in TRD Appendix A.1–A.2. Neither depends on Claude's Gmail/Drive/Calendar connectors.
- The likely next step is `/to-tickets` to break this spec into vertical-slice issues under `.scratch/school-management-v1/issues/`.
