import type { academic, calendar, enrollment, Offering, offerings } from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { Alert, Field, formText, SubmitButton } from "../components/form";
import { useSubmit } from "../components/use-submit";

type Role = Offering["lecturers"][number]["role"];

const ROLE_LABELS: Record<Role, string> = {
  PRIMARY: "Primary",
  CO_LECTURER: "Co-lecturer",
  ASSISTANT: "Assistant",
  GUEST_LECTURER: "Guest lecturer",
};

const semestersQuery = queryOptions({
  queryKey: ["semesters"],
  queryFn: ({ signal }) => api<typeof calendar.listSemesters>("GET", "/semesters", { signal }),
});
const lecturersQuery = queryOptions({
  queryKey: ["lecturers"],
  queryFn: ({ signal }) => api<typeof offerings.listLecturers>("GET", "/lecturers", { signal }),
});
const offeringsQuery = (semesterId: string) =>
  queryOptions({
    queryKey: ["offerings", semesterId],
    queryFn: ({ signal }) =>
      api<typeof offerings.listOfferings>("GET", "/course-offerings", {
        signal,
        query: { semesterId },
      }),
    enabled: semesterId !== "",
  });
const offeringQuery = (id: string) =>
  queryOptions({
    queryKey: ["offering", id],
    queryFn: ({ signal }) =>
      api<typeof offerings.getOffering>("GET", "/course-offerings/:id", { signal, params: { id } }),
  });
const coursesQuery = queryOptions({
  queryKey: ["courses", "active"],
  queryFn: ({ signal }) =>
    api<typeof academic.listCourses>("GET", "/courses", {
      signal,
      query: { status: "ACTIVE", limit: 100 },
    }),
});

/** Course Offerings per semester (TRD §9.2). */
export function AdminOfferingsPage() {
  const semesters = useQuery(semestersQuery);
  const [semesterId, setSemesterId] = useState("");
  const chosen = semesterId || (semesters.data?.items.find((s) => s.status !== "CLOSED")?.id ?? "");
  const list = useQuery(offeringsQuery(chosen));

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Course Offerings</h2>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Semester</span>
        <select
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-2"
          value={chosen}
          onChange={(e) => {
            setSemesterId(e.target.value);
          }}
        >
          {semesters.data?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code}) · {s.status.toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white text-sm">
        {list.data?.items.map((o) => (
          <li key={o.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
            <Link
              to="/admin/offerings/$offeringId"
              params={{ offeringId: o.id }}
              className="font-medium text-brand underline"
            >
              {o.courseCode} {o.title} ({o.sectionCode})
            </Link>
            <span className="text-slate-600">
              {o.status.toLowerCase()} ·{" "}
              {o.lecturers.find((l) => l.role === "PRIMARY")?.lecturerName ?? "no Primary"}
            </span>
          </li>
        ))}
        {list.data?.items.length === 0 ? (
          <li className="px-3 py-2 text-slate-500">No offerings in this semester yet.</li>
        ) : null}
      </ul>
      {chosen !== "" ? <NewOffering semesterId={chosen} /> : null}
    </div>
  );
}

function NewOffering({ semesterId }: { semesterId: string }) {
  const courses = useQuery(coursesQuery);
  const lecturers = useQuery(lecturersQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { busy, error, fieldErrors, run } = useSubmit();
  return (
    <details className="rounded border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-medium">Offer a course this semester</summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          const primary = formText(d, "primary");
          void run(async () => {
            const created = await api<typeof offerings.createOffering>(
              "POST",
              "/course-offerings",
              {
                body: {
                  courseId: formText(d, "courseId"),
                  semesterId,
                  sectionCode: formText(d, "sectionCode") || "01",
                  lecturers: primary === "" ? [] : [{ lecturerId: primary, role: "PRIMARY" }],
                },
              },
            );
            await queryClient.invalidateQueries({ queryKey: ["offerings"] });
            await navigate({
              to: "/admin/offerings/$offeringId",
              params: { offeringId: created.id },
            });
          });
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Course</span>
          <select
            name="courseId"
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-2"
            required
          >
            {courses.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} {c.title}
              </option>
            ))}
          </select>
        </label>
        <Field
          id="sectionCode"
          name="sectionCode"
          label="Section"
          defaultValue="01"
          error={fieldErrors.sectionCode}
        />
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Primary Lecturer</span>
          <select
            name="primary"
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-2"
          >
            <option value="">Choose later</option>
            {lecturers.data?.items
              .filter((l) => l.status === "ACTIVE")
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.displayName}
                </option>
              ))}
          </select>
        </label>
        <SubmitButton busy={busy}>Create offering</SubmitButton>
      </form>
    </details>
  );
}

/** One offering: who teaches it, publishing and cancelling (TRD §9.4). */
export function AdminOfferingPage() {
  const { offeringId } = useParams({ from: "/admin/offerings/$offeringId" });
  const offering = useQuery(offeringQuery(offeringId));
  const lecturers = useQuery(lecturersQuery);
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  if (offering.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (offering.isError) return <Alert tone="error">{offering.error.message}</Alert>;
  const o = offering.data;
  const set = (next: Offering): void => {
    queryClient.setQueryData(offeringQuery(offeringId).queryKey, next);
  };
  const open = o.status !== "COMPLETED" && o.status !== "CANCELLED";

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">
        {o.courseCode} {o.title}{" "}
        <span className="text-base font-normal text-slate-600">({o.sectionCode})</span>
      </h2>
      <p className="text-slate-600">
        {o.semesterName}, {o.sessionCode} · {o.credits} credits · {o.status.toLowerCase()}
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <section className="space-y-2 rounded border border-slate-200 bg-white p-4">
        <h3 className="font-semibold">Lecturers</h3>
        <ul className="space-y-1">
          {o.lecturers.map((l) => (
            <li key={l.id} className="flex justify-between gap-2">
              <span>
                {l.lecturerName} · {ROLE_LABELS[l.role]}
              </span>
              {open ? (
                <button
                  type="button"
                  className="text-sm text-red-700 underline"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      await api<typeof offerings.endAssignment>(
                        "DELETE",
                        "/course-offerings/:id/lecturers/:assignmentId",
                        {
                          params: { id: o.id, assignmentId: l.id },
                        },
                      );
                      await queryClient.invalidateQueries({ queryKey: ["offering", o.id] });
                    });
                  }}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {open ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const d = new FormData(event.currentTarget);
              void run(async () => {
                set(
                  await api<typeof offerings.assignLecturer>(
                    "POST",
                    "/course-offerings/:id/lecturers",
                    {
                      params: { id: o.id },
                      body: {
                        lecturerId: formText(d, "lecturerId"),
                        role: formText(d, "role") as Role,
                      },
                    },
                  ),
                );
              });
            }}
          >
            <select
              name="lecturerId"
              aria-label="Lecturer"
              className="rounded border border-slate-300 px-2 py-2"
            >
              {lecturers.data?.items
                .filter((l) => l.status === "ACTIVE")
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.displayName}
                  </option>
                ))}
            </select>
            <select
              name="role"
              aria-label="Role"
              className="rounded border border-slate-300 px-2 py-2"
            >
              {(Object.entries(ROLE_LABELS) as [Role, string][]).map(([role, label]) => (
                <option key={role} value={role}>
                  {label}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-brand px-3 py-2 text-white" disabled={busy}>
              Assign
            </button>
          </form>
        ) : null}
      </section>
      <div className="flex flex-wrap gap-3">
        {o.status === "DRAFT" ? (
          <button
            type="button"
            className="rounded bg-brand px-3 py-2 text-white"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                set(
                  await api<typeof offerings.publishOffering>(
                    "POST",
                    "/course-offerings/:id/publish",
                    { params: { id: o.id } },
                  ),
                );
              });
            }}
          >
            Publish
          </button>
        ) : null}
        {open ? (
          <button
            type="button"
            className="rounded border border-red-300 px-3 py-2 text-red-700"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt("Why cancel this offering?");
              if (reason === null || reason.trim().length < 3) return;
              void run(async () => {
                set(
                  await api<typeof offerings.cancelOffering>(
                    "POST",
                    "/course-offerings/:id/cancel",
                    { params: { id: o.id }, body: { reason } },
                  ),
                );
              });
            }}
          >
            Cancel offering
          </button>
        ) : null}
      </div>
      <Roster offeringId={o.id} open={open} />
    </div>
  );
}

/** Who's registered, manual registration (e.g. retakes) and withdrawal, with reasons (§9.3). */
function Roster({ offeringId, open }: { offeringId: string; open: boolean }) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const key = ["offerings", offeringId, "roster"];
  const roster = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<typeof enrollment.getRoster>("GET", "/course-offerings/:id/enrollments", {
        params: { id: offeringId },
        signal,
      }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const enrolled = roster.data?.items.filter((r) => r.status === "ENROLLED").length ?? 0;

  return (
    <section className="space-y-2 rounded border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">Students ({enrolled} enrolled)</h3>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="divide-y divide-slate-100 text-sm">
        {roster.data?.items.map((r) => (
          <li
            key={r.courseEnrollmentId}
            className="flex flex-wrap items-center justify-between gap-2 py-1"
          >
            <span>
              {r.studentName} · {r.matricNumber} · Level {r.levelNo}
            </span>
            <span className="flex items-center gap-3 text-slate-600">
              {r.selection.toLowerCase()} · {r.status.toLowerCase()}
              {r.status === "ENROLLED" ? (
                <button
                  type="button"
                  className="text-red-700 underline"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt(`Why withdraw ${r.studentName}?`);
                    if (reason === null || reason.trim().length < 3) return;
                    void run(async () => {
                      await api<typeof enrollment.withdrawCourseEnrollment>(
                        "POST",
                        "/course-enrollments/:id/withdraw",
                        { params: { id: r.courseEnrollmentId }, body: { reason } },
                      );
                      await refresh();
                    });
                  }}
                >
                  Withdraw
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {open ? (
        <form
          // eslint-disable-next-line glim/design-tokens -- design-exception: geometry, form grid columns
          className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            void run(async () => {
              await api<typeof enrollment.registerManually>(
                "POST",
                "/course-offerings/:id/enrollments",
                {
                  params: { id: offeringId },
                  body: {
                    matricNumber: formText(data, "matricNumber"),
                    reason: formText(data, "reason"),
                  },
                },
              );
              form.reset();
              await refresh();
            });
          }}
        >
          <Field id="matricNumber" name="matricNumber" label="Matric Number" required />
          <Field id="reason" name="reason" label="Reason (e.g. retake)" required minLength={3} />
          <div className="self-end">
            <SubmitButton busy={busy}>Register student</SubmitButton>
          </div>
        </form>
      ) : null}
    </section>
  );
}

/** Lecturer profiles (TRD §16 People). */
export function AdminLecturersPage() {
  const lecturers = useQuery(lecturersQuery);
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Lecturers</h2>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white text-sm">
        {lecturers.data?.items.map((l) => (
          <li key={l.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
            <span className="font-medium">{l.displayName}</span>
            <span className="text-slate-600">
              {l.email} · {l.kind.toLowerCase()}
              {l.status === "INACTIVE" ? " · inactive" : ""}
            </span>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const d = new FormData(form);
          void run(async () => {
            const result = await api<typeof offerings.createLecturer>("POST", "/lecturers", {
              body: {
                email: formText(d, "email"),
                title: formText(d, "title") || null,
                givenName: formText(d, "givenName"),
                familyName: formText(d, "familyName"),
                kind: formText(d, "kind") === "GUEST" ? "GUEST" : "INTERNAL",
              },
            });
            setNotice(
              result.invited
                ? `${result.lecturer.displayName} was invited by email.`
                : `${result.lecturer.displayName} is now a Lecturer.`,
            );
            form.reset();
            await queryClient.invalidateQueries({ queryKey: ["lecturers"] });
          });
        }}
      >
        <h3 className="font-semibold sm:col-span-2">Add a Lecturer</h3>
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          id="l-email"
          name="email"
          type="email"
          label="Email"
          required
          error={fieldErrors.email}
        />
        <Field id="l-title" name="title" label="Title (e.g. Rev, Dr)" />
        <Field id="l-given" name="givenName" label="Given name" required />
        <Field id="l-family" name="familyName" label="Family name" required />
        <label className="text-sm">
          <span className="block font-medium text-slate-700">Kind</span>
          <select
            name="kind"
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-2"
          >
            <option value="INTERNAL">GLIM staff</option>
            <option value="GUEST">Guest</option>
          </select>
        </label>
        <SubmitButton busy={busy}>Add Lecturer</SubmitButton>
      </form>
    </div>
  );
}
