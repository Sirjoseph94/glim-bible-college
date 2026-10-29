# Record of processing activities (NDPA 2023, GAID 2025)

**Controller:** GLIM Online Bible College. **Prepared by:** engineering, for the college's Data
Protection Officer to review. This is the engineering record of what the system processes (TRD
§19.4); it is not legal advice. Keep it in step with `packages/db/src/schema/` and the TRD.

| # | Activity | Data subjects | Personal data | Purpose | Lawful basis | Where held / processors | Retention |
|---|---|---|---|---|---|---|---|
| 1 | Accounts and sign-in | Applicants, students, Lecturers, staff | Name, email, password hash, Google account id and email, sessions (IP, browser), time zone | Run the service securely | Contract; legitimate interest (security) | Neon PostgreSQL (Frankfurt); Google (OIDC sign-in) | Life of the account; ended sessions deleted hourly; account erasable on request |
| 2 | Admissions | Applicants | Personal, contact, address, church and pastor details, education, passport photo, **spiritual background (religious belief: sensitive)**, consent and declaration | Decide admission | Explicit consent (application section 8) for the sensitive answers; contract for the rest | PostgreSQL; Cloudflare R2 (photos) | Purged after the intake (ADMISSIONS policy, default 12 months); drafts after inactivity. Sensitive answers are never copied to the student record (INV-15) |
| 3 | Student record and enrollment | Students | Matric Number, profile copied from the application (no spiritual answers), programme, semester and course enrollments | Run the programme | Contract | PostgreSQL | Permanent academic record; personal details erasable (see below) |
| 4 | Teaching and assessment | Students, Lecturers | Submissions and files, quiz answers, grades and feedback, attendance (roll call, online presence) | Teach and assess | Contract | PostgreSQL; R2 (files) | Permanent as part of the academic record |
| 5 | Recordings | Students and Lecturers who appear or speak | Video and audio of Class Meetings | Let students rewatch classes | Legitimate interest, with the recording notice (C-40) | **YouTube** (unlisted videos on GLIM's channel, Google's consumer terms; covered by the DPIA, D-08) | Until deleted by the System Admin (C-24) |
| 6 | Results, awards and transcripts | Students and graduates | Course and semester results, GPA, CGPA, standing, award class, certificate numbers, issued transcripts (snapshot with legal name and Matric Number) | Academic records; verification for third parties | Legal obligation (academic records); contract | PostgreSQL; R2 (PDFs) | Permanent. Public verification shows only initials, programme, status and dates |
| 7 | Notifications and email | All users | Email address, notification content, delivery status, bounces | Tell people what they need to know | Contract; legitimate interest | PostgreSQL; **Brevo** (email delivery over SMTP; it blocks hard-bounced and complaining addresses itself) | Notifications deleted on erasure |
| 8 | Audit log | Staff and users acting in the system | Who did what and when, with IP and request id | Accountability and security | Legal obligation; legitimate interest | PostgreSQL (append-only) | Kept; personal details in it are ids, not names |
| 9 | Backups | Everyone above | A copy of the database | Disaster recovery | Legitimate interest | R2 backup bucket, age-encrypted | Rotated per the backup runbook |

The public privacy policy (`/privacy`, `apps/web/src/routes/legal.tsx`) is written from this record. Change them together.

## Data subject rights

- **Access:** anyone signed in can download everything held about them from their profile (`GET /me/data-export`, JSON). Grades still in draft, other people's data and security secrets are left out.
- **Erasure:** the System Admin erases a person from their user page (`POST /users/:id/erase`, audited with a reason). Their account is anonymised and deactivated; sign-in methods, sessions, notifications, preferences, applications (with the sensitive answers) and passport photos are deleted; the student and Lecturer profiles keep only a pseudonym. **Retained by law:** results, awards, issued transcripts and coursework, under the pseudonymous student id, and the audit log. Staff roles must be revoked first.
- **Rectification:** staff correct records in the admin screens; every change is audited.

## Transfers outside Nigeria

Hostinger (VPS in the United Kingdom; ADR-0004 planned Germany), Neon (database, Frankfurt), Cloudflare (R2 files and backups, EU jurisdiction), Google (sign-in, YouTube) and Brevo (France) process data outside Nigeria (ADR-0004). Their DPAs or terms review is a launch gate (C-41); YouTube runs under Google's consumer terms, so the DPIA covers publishing recordings there (ADR-0003).
