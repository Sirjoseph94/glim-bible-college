import type { academic, CurriculumDetail } from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { isNotAvailable, LoadFailed, NotAvailable } from "../components/app/page-states";
import { useDetailBar } from "../components/app/shell-parts";
import { CalendarDate } from "../components/time";
import { Badge } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { DataTable, bodyCell, headCell } from "../components/ui/data-table";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";
import { coursesQuery, CURRICULUM_STATUS } from "./admin-academic";

const curriculumQuery = (id: string) =>
  queryOptions({
    queryKey: ["curriculum", id],
    queryFn: ({ signal }) =>
      api<typeof academic.getCurriculum>("GET", "/curricula/:id", { signal, params: { id } }),
  });

/** A course in the editor; its place in the order is its place in the list (ADR-0005). */
type Row = { courseId: string; creditOverride: string | null };

const toRows = (c: CurriculumDetail): Row[] =>
  c.placements.map((p) => ({ courseId: p.courseId, creditOverride: p.creditOverride }));

/** The list with the row at `from` moved to `to`. */
function moved(rows: Row[], from: number, to: number): Row[] {
  const next = [...rows];
  const [row] = next.splice(from, 1);
  if (row !== undefined) next.splice(to, 0, row);
  return next;
}

/** A compact control for a table cell; its label is the cell's `aria-label`. */
const CELL_CONTROL =
  "min-h-tap rounded-sm border border-line-strong bg-surface-raised px-2 text-body-sm text-ink " +
  "disabled:border-transparent disabled:bg-surface-sunken disabled:text-ink-muted " +
  "aria-invalid:border-2 aria-invalid:border-danger";

export function AdminCurriculumPage() {
  const { curriculumId } = useParams({ from: "/admin/curricula/$curriculumId" });
  const curriculum = useQuery(curriculumQuery(curriculumId));
  useDetailBar({ back: { to: "/admin/academic", label: "Programmes and courses" } });
  if (curriculum.isPending)
    return (
      <SkeletonGroup label="Loading the curriculum">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-48" />
      </SkeletonGroup>
    );
  if (curriculum.isError)
    return isNotAvailable(curriculum.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="the curriculum" onRetry={() => void curriculum.refetch()} />
    );
  return (
    <Editor
      key={`${curriculum.data.id}-${String(curriculum.data.version)}`}
      curriculum={curriculum.data}
    />
  );
}

function Editor({ curriculum }: { curriculum: CurriculumDetail }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const courses = useQuery(coursesQuery(""));
  const [rows, setRows] = useState<Row[]>(toRows(curriculum));
  const [pending, setPending] = useState<"save" | "activate" | "clone" | null>(null);
  const { busy, problem, fieldErrors, run } = useSubmit();
  const editable = !curriculum.locked;
  const courseName = new Map(courses.data?.items.map((c) => [c.id, `${c.code} ${c.title}`]) ?? []);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["curriculum", curriculum.id] });
  const status = CURRICULUM_STATUS[curriculum.status];
  const loading = (action: typeof pending) => busy && pending === action;

  const update = (i: number, change: Partial<Row>) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));
  };

  const activate = () => {
    setPending("activate");
    void run(async () => {
      await api<typeof academic.activateCurriculum>("POST", "/curricula/:id/activate", {
        params: { id: curriculum.id },
      });
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["curricula"] });
    });
  };

  const clone = () => {
    setPending("clone");
    void run(async () => {
      const copy = await api<typeof academic.cloneCurriculum>("POST", "/curricula/:id/clone", {
        params: { id: curriculum.id },
        body: { effectiveFrom: new Date().toISOString().slice(0, 10) },
      });
      await queryClient.invalidateQueries({ queryKey: ["curricula"] });
      await navigate({ to: "/admin/curricula/$curriculumId", params: { curriculumId: copy.id } });
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Curriculum v${String(curriculum.curriculumVersion)}`}
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.word}</Badge>
            <span>
              Effective from <CalendarDate value={curriculum.effectiveFrom} />.{" "}
              {curriculum.totalCredits} credits in all: the Certificate needs half of them passed,
              the Diploma every course.
            </span>
          </span>
        }
        actions={
          <>
            {curriculum.status === "DRAFT" ? (
              <Button variant="primary" loading={loading("activate")} onClick={activate}>
                Activate
              </Button>
            ) : null}
            <Button variant="secondary" loading={loading("clone")} onClick={clone}>
              Clone to a new version
            </Button>
          </>
        }
      />
      {curriculum.locked ? (
        <Banner tone="info" title="This curriculum is locked">
          Clone it to make a new version you can edit.
        </Banner>
      ) : null}
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setPending("save");
          void run(async () => {
            await api<typeof academic.putPlacements>("PUT", "/curricula/:id/courses", {
              params: { id: curriculum.id },
              headers: { "if-match": `"${String(curriculum.version)}"` },
              body: { placements: rows },
            });
            await refresh();
          });
        }}
      >
        {rows.length === 0 ? (
          <EmptyState icon="book" title="No courses yet">
            {editable
              ? "Add the courses in the order cohorts usually take them, then save."
              : "This version has no courses."}
          </EmptyState>
        ) : (
          <DataTable caption="Curriculum courses" minWidth="min-w-160">
            <thead>
              <tr>
                <th scope="col" className={headCell}>
                  Order
                </th>
                <th scope="col" className={headCell}>
                  Course
                </th>
                <th scope="col" className={headCell}>
                  Credit override
                </th>
                <th scope="col" className={headCell}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const n = String(i + 1);
                const courseError = fieldErrors[`placements.${String(i)}.courseId`];
                return (
                  <tr key={`${row.courseId}-${String(i)}`}>
                    <td className={`${bodyCell} tabular-nums`}>{n}</td>
                    <td className={`${bodyCell} whitespace-normal`}>
                      <select
                        aria-label={`Course ${n}`}
                        aria-invalid={courseError ? true : undefined}
                        disabled={!editable}
                        value={row.courseId}
                        onChange={(e) => {
                          update(i, { courseId: e.target.value });
                        }}
                        className={`${CELL_CONTROL} w-full`}
                      >
                        {courses.data?.items
                          .filter((c) => c.status === "ACTIVE" || c.id === row.courseId)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {courseName.get(c.id)}
                            </option>
                          ))}
                      </select>
                      {courseError ? (
                        <p className="mt-1 text-body-sm text-danger">{courseError}</p>
                      ) : null}
                    </td>
                    <td className={bodyCell}>
                      <input
                        aria-label={`Credit override ${n}`}
                        disabled={!editable}
                        inputMode="decimal"
                        value={row.creditOverride ?? ""}
                        onChange={(e) => {
                          update(i, {
                            creditOverride: e.target.value === "" ? null : e.target.value,
                          });
                        }}
                        className={`${CELL_CONTROL} w-20`}
                      />
                    </td>
                    <td className={bodyCell}>
                      {editable ? (
                        // Not saved until "Save courses", so no confirmation is needed.
                        <span className="flex gap-1">
                          <Button
                            size="sm"
                            variant="quiet"
                            aria-label={`Move course ${n} earlier`}
                            disabled={i === 0}
                            onClick={() => {
                              setRows(moved(rows, i, i - 1));
                            }}
                          >
                            Up
                          </Button>
                          <Button
                            size="sm"
                            variant="quiet"
                            aria-label={`Move course ${n} later`}
                            disabled={i === rows.length - 1}
                            onClick={() => {
                              setRows(moved(rows, i, i + 1));
                            }}
                          >
                            Down
                          </Button>
                          <Button
                            size="sm"
                            variant="quiet"
                            aria-label={`Remove course ${n}`}
                            onClick={() => {
                              setRows(rows.filter((_, j) => j !== i));
                            }}
                          >
                            Remove
                          </Button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
        {editable ? (
          <div className="flex flex-col gap-2 md:flex-row">
            <Button
              variant="secondary"
              icon="book"
              onClick={() => {
                const first = courses.data?.items.find((c) => c.status === "ACTIVE");
                if (first)
                  setRows([
                    ...rows,
                    { courseId: first.id, creditOverride: null },
                  ]);
              }}
            >
              Add a course
            </Button>
            <Button type="submit" variant="primary" loading={loading("save")}>
              Save courses
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
