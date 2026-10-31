# schema-and-migration

**What to build:** The forward migration and Drizzle schema for the model in the spec; enum list updated; constraint tests.

**Status:** done

**Spec:** `.scratch/block-teaching/spec.md`

## Comments

**Implemented (2026-10-30).** `0050_block_teaching.sql` (generated, then edited: a guard that refuses to run over any offering, programme enrollment, result or award; Certificate programmes archived; intake `starts_on` and curriculum `position` backfilled from the old session and Level/semester order; the old consistency trigger dropped first) and `0051_block_teaching_constraints.sql` (custom: no overlap per cohort, no overlapping intake windows, deferrable unique positions, the new consistency trigger). `course_offerings` moved to `schema/offerings.ts` and `files` to `schema/files.ts` to keep the schema free of import cycles. Checked on a scratch database seeded with the old shape; constraint behaviour is covered by `offerings`, `intakes` and `academic` itests.
