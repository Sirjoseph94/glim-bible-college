# 10: Lecturers, Course Offerings and lecturer assignments

**What to build:** The Academic Admin creates Lecturer profiles and Course Offerings for a semester, assigns Lecturers by role, and publishes offerings. Lecturers see "My offerings" (TRD §9.2, §9.4, §7.4).

**Blocked by:** 09 (Academic calendar and Rooms)

**Status:** done

- [x] Lecturer profiles linked to users (internal/guest)
- [x] Course Offerings per course + semester + section; lifecycle draft → published → active → completed / cancelled
- [x] Lecturer assignments with roles PRIMARY, CO_LECTURER, ASSISTANT, GUEST_LECTURER; exactly one active PRIMARY (DB index); PRIMARY swap is transactional; ending the last PRIMARY is rejected (`PRIMARY_REQUIRED`)
- [x] Publishing requires an active PRIMARY
- [x] The Lecturer path of `AuthorizationService` (capability table §7.4) is implemented and covered by deny tests
- [x] Lecturer "My offerings" screen; admin offering screens

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-07).**
- **Schema:**
  - `lecturers`, `course_offerings` and `lecturer_assignments`, with the TRD's partial unique indexes: one active assignment per lecturer and offering, and **one active PRIMARY** per offering.
  - The `v_offering_access` view, STAFF rows only; ticket 19 adds students.
- **Lecturer profiles:** creating one links the existing account with that email, or invites a new one in the same transaction. The TRD catalogue gives this to `identity:user:manage` (System Admin), but the ticket and spec story 46 give it to the Academic Admin, so it uses `lecturing:assignment:manage` (System Admin and Academic Admin).
- **Offerings:** created with their first lecturers in one transaction (§9.2), with domain events throughout.
  - Assigning a PRIMARY ends the current one, all in one transaction.
  - Ending the only PRIMARY of a published or active offering is refused with `PRIMARY_REQUIRED`.
  - Publishing requires an active PRIMARY. Lecturing registers that rule with academic's `OfferingsService`, so the two modules don't depend on each other in a cycle.
- **Lecturer authorization path:** "*" means any active Lecturer; a capability means an assignment on the resource's offering, per the §7.4 table, where `capability_overrides` win. Results are memoized per request.
- **`GET /course-offerings`:** filters in SQL through `v_offering_access` for Lecturers (VisibleOfferings).
- **`/me`:** `roles.isLecturer` is now derived.
- **Personas:** l1Primary, l2Co and l3Assistant on O1, and l4Other on O2, in a persona world. The generated deny tests predict each lecturer outcome from `matrix.json` (522 cases).
- **Screens:** offerings per semester, an offering page (staffing, publish, cancel), Lecturers, and the Lecturer's "My offerings" (`/teach`). Playwright covers adding a lecturer, creating and publishing an offering, and the lecturer seeing it.
- **Environment note:** long background test runs need `caffeinate -i` on this Mac, because idle sleep on battery stalled two runs.
