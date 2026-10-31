# ADR-0005: Block teaching replaces semesters

**Status:** Accepted (owner, 30 October 2026). Supersedes C-30 (the semester registration chain), C-32 (two semesters a year), the "Certificate and Diploma are separate programmes" decision, and defaults D-01 and D-03.
**Date:** 2026-10-30
**Deciders:** GLIM owner

GLIM teaches **one course at a time**. Each course offering has its own start date, end date and exam date. A cohort works through the curriculum in an order the Academic Admin sets for that cohort (its **Cohort Schedule**), and the offerings in one schedule may not overlap. There are no semesters, no Academic Sessions and no Levels. There is **one programme, the Diploma**. The **Certificate** is an award within it, proposed once a student has passed courses worth half the curriculum's credits. The Diploma is proposed once they have passed every course. Intakes are no longer one fixed yearly window. Each intake has its own application dates and start date, and there may be several a year.

The model this replaces taught every course in parallel within a September–June year of two semesters, with semester GPAs, semester results, and Year 1 → Year 2 progression. The owner chose block teaching because that is how GLIM actually teaches.

## Consequences

- **Correctness stays in Postgres.** Two exclusion constraints back the new model: no overlap between offerings in a cohort's schedule, and the existing room and lecturer exclusions. Class Meetings and the exam date must fall within the offering's dates. A makeup exam date may fall after the end date.
- **Registration is automatic.** Publishing an offering registers its cohort's ACTIVE students in the same transaction. There are no electives and no add/drop window. Retakes and late joiners are manual registrations into another offering.
- **Results lose the semester layer.** Course results, credits, the CGPA (repeat policy BEST) and award classes are unchanged. Semester GPA and `semester_results` are removed. The Registrar approves course results instead, and a CGPA is *Provisional* until every result it counts is approved. The broadsheet is per cohort, and transcripts list courses in the order taken.
- **The offering lifecycle runs on dates.** A daily job moves an offering to ACTIVE on its start date and to COMPLETED the day after its end date. Before, closing a semester did this.
- **The migration is destructive.** Production held no academic records when this was decided, so the semester tables and columns are dropped rather than converted.

## Considered options

- **Rolling cycle**: courses loop continuously, and a new student joins whichever course is running. It was rejected because the college keeps intakes and admits students as cohorts.
- **Semesters kept as a calendar with per-course registration**: rejected, because courses are not taught side by side.
