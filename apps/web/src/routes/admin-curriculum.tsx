import type { academic, CurriculumDetail } from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { Alert, SubmitButton } from "../components/form";
import { useSubmit } from "../components/use-submit";
import { coursesQuery } from "./admin-academic";

const curriculumQuery = (id: string) =>
  queryOptions({
    queryKey: ["curriculum", id],
    queryFn: ({ signal }) =>
      api<typeof academic.getCurriculum>("GET", "/curricula/:id", { signal, params: { id } }),
  });

type Row = {
  courseId: string;
  levelNo: number;
  semesterNo: 1 | 2;
  courseType: "COMPULSORY" | "ELECTIVE";
  creditOverride: string | null;
};

const toRows = (c: CurriculumDetail): Row[] =>
  c.placements.map((p) => ({
    courseId: p.courseId,
    levelNo: p.levelNo,
    semesterNo: p.semesterNo === 2 ? 2 : 1,
    courseType: p.courseType,
    creditOverride: p.creditOverride,
  }));

export function AdminCurriculumPage() {
  const { curriculumId } = useParams({ from: "/admin/curricula/$curriculumId" });
  const curriculum = useQuery(curriculumQuery(curriculumId));
  if (curriculum.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (curriculum.isError) return <Alert tone="error">{curriculum.error.message}</Alert>;
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
  const { busy, error, fieldErrors, run } = useSubmit();
  const editable = !curriculum.locked;
  const courseName = new Map(courses.data?.items.map((c) => [c.id, `${c.code} ${c.title}`]) ?? []);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["curriculum", curriculum.id] });

  const update = (i: number, change: Partial<Row>) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">
        Curriculum v{curriculum.curriculumVersion}{" "}
        <span className="text-base font-normal text-slate-600">
          · {curriculum.status.toLowerCase()}
        </span>
      </h2>
      <p className="text-sm text-slate-600">
        Effective from {curriculum.effectiveFrom}. Students need {curriculum.minElectiveCredits}{" "}
        elective credits for the award.
      </p>
      {curriculum.locked ? (
        <Alert tone="error">
          This curriculum is locked. Clone it to make a new version you can edit.
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
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
        <div
          role="region"
          aria-label="Curriculum courses"
          tabIndex={0}
          className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {/* eslint-disable-next-line glim/design-tokens -- design-exception: geometry, table min width so columns never squash */}
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="p-1">Course</th>
                <th className="p-1">Level</th>
                <th className="p-1">Semester</th>
                <th className="p-1">Type</th>
                <th className="p-1">Credit override</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.courseId}-${String(i)}`} className="border-t border-slate-200">
                  <td className="p-1">
                    <select
                      aria-label={`Course ${String(i + 1)}`}
                      disabled={!editable}
                      value={row.courseId}
                      onChange={(e) => {
                        update(i, { courseId: e.target.value });
                      }}
                      className="w-full rounded border border-slate-300 px-1 py-1"
                    >
                      {courses.data?.items
                        .filter((c) => c.status === "ACTIVE" || c.id === row.courseId)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {courseName.get(c.id)}
                          </option>
                        ))}
                    </select>
                    {fieldErrors[`placements.${String(i)}.courseId`] ? (
                      <p className="text-red-700">
                        {fieldErrors[`placements.${String(i)}.courseId`]}
                      </p>
                    ) : null}
                  </td>
                  <td className="p-1">
                    <input
                      aria-label={`Level ${String(i + 1)}`}
                      type="number"
                      min={1}
                      max={4}
                      disabled={!editable}
                      value={row.levelNo}
                      onChange={(e) => {
                        update(i, { levelNo: Number(e.target.value) });
                      }}
                      className="w-16 rounded border border-slate-300 px-1 py-1"
                    />
                  </td>
                  <td className="p-1">
                    <select
                      aria-label={`Semester ${String(i + 1)}`}
                      disabled={!editable}
                      value={row.semesterNo}
                      onChange={(e) => {
                        update(i, { semesterNo: e.target.value === "2" ? 2 : 1 });
                      }}
                      className="rounded border border-slate-300 px-1 py-1"
                    >
                      <option value={1}>1 (Sept–Jan)</option>
                      <option value={2}>2 (Feb–June)</option>
                    </select>
                  </td>
                  <td className="p-1">
                    <select
                      aria-label={`Type ${String(i + 1)}`}
                      disabled={!editable}
                      value={row.courseType}
                      onChange={(e) => {
                        update(i, {
                          courseType: e.target.value === "ELECTIVE" ? "ELECTIVE" : "COMPULSORY",
                        });
                      }}
                      className="rounded border border-slate-300 px-1 py-1"
                    >
                      <option value="COMPULSORY">Compulsory</option>
                      <option value="ELECTIVE">Elective</option>
                    </select>
                  </td>
                  <td className="p-1">
                    <input
                      aria-label={`Credit override ${String(i + 1)}`}
                      disabled={!editable}
                      inputMode="decimal"
                      value={row.creditOverride ?? ""}
                      onChange={(e) => {
                        update(i, {
                          creditOverride: e.target.value === "" ? null : e.target.value,
                        });
                      }}
                      className="w-20 rounded border border-slate-300 px-1 py-1"
                    />
                  </td>
                  <td className="p-1">
                    {editable ? (
                      <button
                        type="button"
                        className="text-red-700 underline"
                        onClick={() => {
                          setRows(rows.filter((_, j) => j !== i));
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="underline"
              onClick={() => {
                const first = courses.data?.items.find((c) => c.status === "ACTIVE");
                if (first)
                  setRows([
                    ...rows,
                    {
                      courseId: first.id,
                      levelNo: 1,
                      semesterNo: 1,
                      courseType: "COMPULSORY",
                      creditOverride: null,
                    },
                  ]);
              }}
            >
              Add a course
            </button>
            <SubmitButton busy={busy}>Save placements</SubmitButton>
          </div>
        ) : null}
      </form>

      <div className="flex flex-wrap gap-3">
        {curriculum.status === "DRAFT" ? (
          <button
            type="button"
            className="rounded bg-brand px-3 py-2 text-white"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                await api<typeof academic.activateCurriculum>("POST", "/curricula/:id/activate", {
                  params: { id: curriculum.id },
                });
                await refresh();
                await queryClient.invalidateQueries({ queryKey: ["curricula"] });
              });
            }}
          >
            Activate
          </button>
        ) : null}
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              const copy = await api<typeof academic.cloneCurriculum>(
                "POST",
                "/curricula/:id/clone",
                {
                  params: { id: curriculum.id },
                  body: { effectiveFrom: new Date().toISOString().slice(0, 10) },
                },
              );
              await queryClient.invalidateQueries({ queryKey: ["curricula"] });
              await navigate({
                to: "/admin/curricula/$curriculumId",
                params: { curriculumId: copy.id },
              });
            });
          }}
        >
          Clone to a new version
        </button>
      </div>
    </div>
  );
}
