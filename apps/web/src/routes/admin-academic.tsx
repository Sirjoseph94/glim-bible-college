import type { academic } from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { Alert, Field, formText, SubmitButton } from "../components/form";
import { useSubmit } from "../components/use-submit";

export const programmesQuery = queryOptions({
  queryKey: ["programmes"],
  queryFn: ({ signal }) => api<typeof academic.listProgrammes>("GET", "/programmes", { signal }),
});

export const coursesQuery = (q: string) =>
  queryOptions({
    queryKey: ["courses", q],
    queryFn: ({ signal }) =>
      api<typeof academic.listCourses>("GET", "/courses", { signal, query: { q, limit: 100 } }),
  });

const curriculaQuery = queryOptions({
  queryKey: ["curricula"],
  queryFn: ({ signal }) => api<typeof academic.listCurricula>("GET", "/curricula", { signal }),
});

/** Programmes, the course catalogue and curricula for the Academic Admin (TRD §9.1). */
export function AdminAcademicPage() {
  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold">Programmes and courses</h2>
      <Programmes />
      <Courses />
    </div>
  );
}

function Programmes() {
  const programmes = useQuery(programmesQuery);
  const curricula = useQuery(curriculaQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { busy, error, fieldErrors, run } = useSubmit();

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Programmes</h3>
      {programmes.data?.items.map((programme) => {
        const versions = curricula.data?.items.filter((c) => c.programmeId === programme.id) ?? [];
        return (
          <section
            key={programme.id}
            aria-label={programme.name}
            className="space-y-2 rounded border border-slate-200 bg-white p-3"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">
                {programme.code} · {programme.name}
              </span>
              <span className="text-sm text-slate-600">
                {programme.awardType.toLowerCase()} · {programme.levels} Level(s) ·{" "}
                {programme.durationSemesters} semesters
              </span>
            </div>
            <ul className="space-y-1 text-sm">
              {versions.map((c) => (
                <li key={c.id}>
                  <Link
                    to="/admin/curricula/$curriculumId"
                    params={{ curriculumId: c.id }}
                    className="text-brand underline"
                  >
                    Curriculum v{c.curriculumVersion}
                  </Link>{" "}
                  · {c.status.toLowerCase()} · {c.placementCount} course(s) · from {c.effectiveFrom}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="text-sm underline"
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  const created = await api<typeof academic.createCurriculum>(
                    "POST",
                    "/curricula",
                    {
                      body: {
                        programmeId: programme.id,
                        effectiveFrom: new Date().toISOString().slice(0, 10),
                      },
                    },
                  );
                  await queryClient.invalidateQueries({ queryKey: ["curricula"] });
                  await navigate({
                    to: "/admin/curricula/$curriculumId",
                    params: { curriculumId: created.id },
                  });
                });
              }}
            >
              New curriculum version
            </button>
          </section>
        );
      })}
      <details className="rounded border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer font-medium">Add a programme</summary>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            void run(async () => {
              await api<typeof academic.createProgramme>("POST", "/programmes", {
                body: {
                  code: formText(data, "code"),
                  name: formText(data, "name"),
                  awardType: formText(data, "awardType") as "CERTIFICATE" | "DIPLOMA",
                  levels: Number(formText(data, "levels")),
                  durationSemesters: Number(formText(data, "levels")) * 2,
                },
              });
              form.reset();
              await queryClient.invalidateQueries({ queryKey: ["programmes"] });
            });
          }}
        >
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field
            id="p-code"
            name="code"
            label="Code (e.g. DIP)"
            required
            error={fieldErrors.code}
          />
          <Field id="p-name" name="name" label="Name" required error={fieldErrors.name} />
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-700">Award</span>
            <select
              name="awardType"
              className="block w-full rounded border border-slate-300 px-2 py-2"
            >
              <option value="CERTIFICATE">Certificate</option>
              <option value="DIPLOMA">Diploma</option>
            </select>
          </label>
          <Field
            id="p-levels"
            name="levels"
            type="number"
            min={1}
            max={4}
            label="Levels (years)"
            defaultValue={1}
            required
          />
          <SubmitButton busy={busy}>Add programme</SubmitButton>
        </form>
      </details>
    </section>
  );
}

function Courses() {
  const [q, setQ] = useState("");
  const courses = useQuery(coursesQuery(q));
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Course catalogue</h3>
      <input
        aria-label="Search courses"
        placeholder="Search code or title"
        className="w-full rounded border border-slate-300 px-3 py-2"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
        }}
      />
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white text-sm">
        {courses.data?.items.map((c) => (
          <li key={c.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
            <span>
              <span className="font-medium">{c.code}</span> {c.title}
            </span>
            <span className="text-slate-600">
              {c.credits} credits{c.status === "ARCHIVED" ? " · archived" : ""}
            </span>
          </li>
        ))}
      </ul>
      <details className="rounded border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer font-medium">Add a course</summary>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            void run(async () => {
              await api<typeof academic.createCourse>("POST", "/courses", {
                body: {
                  code: formText(data, "code"),
                  title: formText(data, "title"),
                  credits: formText(data, "credits"),
                  description: null,
                },
              });
              form.reset();
              await queryClient.invalidateQueries({ queryKey: ["courses"] });
            });
          }}
        >
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field id="c-code" name="code" label="Code" required error={fieldErrors.code} />
          <Field id="c-title" name="title" label="Title" required error={fieldErrors.title} />
          <Field
            id="c-credits"
            name="credits"
            label="Credits"
            inputMode="decimal"
            required
            error={fieldErrors.credits}
          />
          <SubmitButton busy={busy}>Add course</SubmitButton>
        </form>
      </details>
    </section>
  );
}
