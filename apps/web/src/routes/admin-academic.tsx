import type { academic, Curriculum } from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { formText } from "../components/form";
import { CalendarDate } from "../components/time";
import { Badge, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { cardClass } from "../components/ui/card";
import {
  DataTable,
  bodyCell,
  headCell,
  numericCell,
  stickyCell,
} from "../components/ui/data-table";
import { Sheet } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Select, TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
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

/** A curriculum's status as a word (UI-3); the curriculum page uses it too. */
export const CURRICULUM_STATUS: Record<Curriculum["status"], { tone: Tone; word: string }> = {
  DRAFT: { tone: "warning", word: "Draft" },
  ACTIVE: { tone: "success", word: "Active" },
  RETIRED: { tone: "neutral", word: "Retired" },
};

/** Programmes, the course catalogue and curricula for the Academic Admin (TRD §9.1). */
export function AdminAcademicPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Programmes and courses" meta="Programmes, their curricula, and courses." />
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
  const { busy, problem, run } = useSubmit();
  const [adding, setAdding] = useState(false);
  // The programme whose new curriculum version is being made, for its button's spinner.
  const [versioning, setVersioning] = useState<string | null>(null);

  const newVersion = (programmeId: string) => {
    setVersioning(programmeId);
    void run(async () => {
      const created = await api<typeof academic.createCurriculum>("POST", "/curricula", {
        body: { programmeId, effectiveFrom: new Date().toISOString().slice(0, 10) },
      });
      await queryClient.invalidateQueries({ queryKey: ["curricula"] });
      await navigate({
        to: "/admin/curricula/$curriculumId",
        params: { curriculumId: created.id },
      });
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-heading">Programmes</h2>
        <Button
          variant="primary"
          icon="award"
          onClick={() => {
            setAdding(true);
          }}
        >
          Add a programme
        </Button>
      </div>
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {programmes.isPending ? (
        <SkeletonGroup label="Loading programmes">
          <Skeleton className="h-32" />
        </SkeletonGroup>
      ) : programmes.isError ? (
        <LoadFailed what="the programmes" onRetry={() => void programmes.refetch()} />
      ) : programmes.data.items.length === 0 ? (
        <EmptyState icon="award" title="No programmes yet">
          Add the school's first programme to start building its curriculum.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {programmes.data.items.map((programme) => {
            const versions =
              curricula.data?.items.filter((c) => c.programmeId === programme.id) ?? [];
            return (
              <section key={programme.id} aria-label={programme.name} className={cardClass()}>
                <div className="space-y-1">
                  <h3 className="text-subhead">
                    {programme.code} · {programme.name}
                  </h3>
                  <p className="text-meta text-ink-muted">
                    {programme.awardType === "DIPLOMA" ? "Diploma" : "Certificate"} ·{" "}
                    {programme.levels} Level(s) · {programme.durationSemesters} semesters
                  </p>
                </div>
                {curricula.isError ? (
                  <div className="mt-3">
                    <LoadFailed what="the curricula" onRetry={() => void curricula.refetch()} />
                  </div>
                ) : versions.length === 0 ? (
                  <p className="mt-3 text-body-sm text-ink-muted">No curriculum yet.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {versions.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Link
                          to="/admin/curricula/$curriculumId"
                          params={{ curriculumId: c.id }}
                          className="inline-flex min-h-tap items-center text-subhead text-brand underline"
                        >
                          Curriculum v{c.curriculumVersion}
                        </Link>
                        <Badge tone={CURRICULUM_STATUS[c.status].tone}>
                          {CURRICULUM_STATUS[c.status].word}
                        </Badge>
                        <span className="text-meta text-ink-muted">
                          {c.placementCount} course(s) · from{" "}
                          <CalendarDate value={c.effectiveFrom} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy && versioning === programme.id}
                    onClick={() => {
                      newVersion(programme.id);
                    }}
                  >
                    New curriculum version
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      )}
      <AddProgrammeSheet open={adding} onOpenChange={setAdding} />
    </section>
  );
}

function AddProgrammeSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const { busy, problem, fieldErrors, run } = useSubmit();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add a programme"
      footer={
        <Button type="submit" form={formId} variant="primary" block loading={busy}>
          Add programme
        </Button>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
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
            await queryClient.invalidateQueries({ queryKey: ["programmes"] });
            onOpenChange(false);
          });
        }}
      >
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        <TextField name="code" label="Code (e.g. DIP)" required error={fieldErrors.code} />
        <TextField name="name" label="Name" required error={fieldErrors.name} />
        <Select name="awardType" label="Award" error={fieldErrors.awardType}>
          <option value="CERTIFICATE">Certificate</option>
          <option value="DIPLOMA">Diploma</option>
        </Select>
        <TextField
          name="levels"
          type="number"
          min={1}
          max={4}
          label="Levels (years)"
          hint="Two semesters per Level."
          defaultValue={1}
          required
          error={fieldErrors.levels}
        />
      </form>
    </Sheet>
  );
}

function Courses() {
  const [q, setQ] = useState("");
  const courses = useQuery(coursesQuery(q));
  const [adding, setAdding] = useState(false);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-heading">Course catalogue</h2>
        <Button
          variant="secondary"
          icon="book"
          onClick={() => {
            setAdding(true);
          }}
        >
          Add a course
        </Button>
      </div>
      <TextField
        type="search"
        label="Search courses"
        placeholder="Search code or title"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
        }}
      />
      {courses.isPending ? (
        <SkeletonGroup label="Loading courses">
          <Skeleton className="h-40" />
        </SkeletonGroup>
      ) : courses.isError ? (
        <LoadFailed what="the courses" onRetry={() => void courses.refetch()} />
      ) : courses.data.items.length === 0 ? (
        <EmptyState icon="book" title={q === "" ? "No courses yet" : "No courses match"}>
          {q === "" ? "Add the courses the school teaches." : "Try another code or title."}
        </EmptyState>
      ) : (
        <DataTable caption="Course catalogue" minWidth="min-w-120">
          <thead>
            <tr>
              <th scope="col" className={`${headCell} ${stickyCell}`}>
                Course
              </th>
              <th scope="col" className={`${headCell} ${numericCell}`}>
                Credits
              </th>
              <th scope="col" className={headCell}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {courses.data.items.map((c) => (
              <tr key={c.id}>
                <td className={`${bodyCell} ${stickyCell}`}>
                  <span className="font-mono text-code">{c.code}</span> {c.title}
                </td>
                <td className={`${bodyCell} ${numericCell}`}>{c.credits}</td>
                <td className={bodyCell}>
                  {c.status === "ARCHIVED" ? (
                    <Badge tone="neutral">Archived</Badge>
                  ) : (
                    <Badge tone="success">Active</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <AddCourseSheet open={adding} onOpenChange={setAdding} />
    </section>
  );
}

function AddCourseSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const { busy, problem, fieldErrors, run } = useSubmit();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add a course"
      description="It joins the catalogue; place it in a curriculum to offer it."
      footer={
        <Button type="submit" form={formId} variant="primary" block loading={busy}>
          Add course
        </Button>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void run(async () => {
            await api<typeof academic.createCourse>("POST", "/courses", {
              body: {
                code: formText(data, "code"),
                title: formText(data, "title"),
                credits: formText(data, "credits"),
                description: null,
              },
            });
            await queryClient.invalidateQueries({ queryKey: ["courses"] });
            onOpenChange(false);
          });
        }}
      >
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        <TextField name="code" label="Code" required error={fieldErrors.code} />
        <TextField name="title" label="Title" required error={fieldErrors.title} />
        <TextField
          name="credits"
          label="Credits"
          inputMode="decimal"
          required
          error={fieldErrors.credits}
        />
      </form>
    </Sheet>
  );
}
