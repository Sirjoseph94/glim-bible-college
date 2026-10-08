import type { assessment, Gradebook, GradebookColumn, GradebookRow } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useId, useState } from "react";
import { api } from "../api/client";
import { Alert, formText } from "../components/form";
import { useSubmit } from "../components/use-submit";

const gradebookKey = (offeringId: string) => ["gradebook", offeringId];

type Cell = GradebookRow["grades"][number];
type ImportResult = Awaited<ReturnType<typeof runImport>>;

const input = "rounded border border-slate-300 px-3 py-2";
const button = "rounded bg-brand px-3 py-2 text-white disabled:opacity-60";

function runImport(
  offeringId: string,
  body: { assessmentId: string; csv: string; dryRun: boolean },
) {
  return api<typeof assessment.importGrades>("POST", "/course-offerings/:id/grades/import", {
    params: { id: offeringId },
    body,
  });
}

/**
 * A course's gradebook (TRD §14.2): a column per assessment, a row per student. Lecturers enter
 * scores, import a column from CSV, set weights and release each column when it's ready.
 */
export function GradebookPage() {
  const { offeringId } = useParams({ strict: false });
  const id = offeringId ?? "";
  const book = useQuery({
    queryKey: gradebookKey(id),
    queryFn: ({ signal }) =>
      api<typeof assessment.getGradebook>("GET", "/course-offerings/:id/gradebook", {
        params: { id },
        signal,
      }),
  });
  const [selected, setSelected] = useState<{ studentId: string; assessmentId: string } | null>(
    null,
  );
  if (book.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (book.isError) return <Alert tone="error">We couldn't load the gradebook.</Alert>;
  const g = book.data;
  const row = g.rows.find((r) => r.studentId === selected?.studentId);
  const column = g.columns.find((c) => c.assessmentId === selected?.assessmentId);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">Gradebook</h2>
        <Link to="/teach" className="text-sm text-brand underline">
          Back to teaching
        </Link>
      </div>
      <p className="text-sm text-slate-600">
        Students see a grade only after you release its column.
      </p>
      <WeightsNote gradebook={g} />
      {g.columns.length === 0 ? (
        <p className="text-sm text-slate-600">
          No columns yet: add assignments, quizzes or a column below.
        </p>
      ) : (
        <GradeTable gradebook={g} offeringId={id} onSelect={setSelected} selected={selected} />
      )}
      {row !== undefined && column !== undefined ? (
        <EditGrade
          key={`${row.studentId}:${column.assessmentId}`}
          offeringId={id}
          row={row}
          column={column}
          cell={row.grades.find((x) => x.assessmentId === column.assessmentId)}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
      <Columns offeringId={id} columns={g.columns} />
      <ImportGrades offeringId={id} columns={g.columns} />
    </div>
  );
}

function WeightsNote({ gradebook: g }: { gradebook: Gradebook }) {
  return g.weightsValid ? (
    <p className="text-sm text-green-700">Published columns' weights add up to 100 %.</p>
  ) : (
    <p
      role="status"
      className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      Published columns' weights add up to {g.weightTotal} %. They must add up to exactly 100 %
      before results can be finalized.
    </p>
  );
}

function GradeTable({
  gradebook: g,
  offeringId,
  selected,
  onSelect,
}: {
  gradebook: Gradebook;
  offeringId: string;
  selected: { studentId: string; assessmentId: string } | null;
  onSelect: (cell: { studentId: string; assessmentId: string }) => void;
}) {
  return (
    // The table scrolls sideways inside its box on a phone; the page itself doesn't.
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left align-bottom">
          <tr>
            <th scope="col" className="sticky left-0 bg-slate-50 p-2">
              Student
            </th>
            {g.columns.map((c) => (
              <th key={c.assessmentId} scope="col" className="min-w-28 p-2 font-medium">
                <div>{c.title}</div>
                <div className="font-normal text-slate-600">
                  /{c.maxScore} · {c.weight} %{c.status === "DRAFT" ? " · draft" : ""}
                </div>
                <ReleaseButton column={c} offeringId={offeringId} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {g.rows.map((r) => (
            <tr key={r.studentId} className="border-t border-slate-100">
              <th scope="row" className="sticky left-0 bg-white p-2 text-left font-normal">
                <div className="font-medium">{r.studentName}</div>
                <div className="text-xs text-slate-500">
                  {r.matricNumber} · {r.studyMode === "ONLINE" ? "Online" : "On-campus"}
                </div>
              </th>
              {g.columns.map((c) => {
                const cell = r.grades.find((x) => x.assessmentId === c.assessmentId);
                const active =
                  selected?.studentId === r.studentId && selected.assessmentId === c.assessmentId;
                return (
                  <td key={c.assessmentId} className="p-1">
                    <button
                      type="button"
                      aria-label={`${r.studentName}, ${c.title}`}
                      aria-pressed={active}
                      className={`w-full rounded px-2 py-1 text-left ${active ? "bg-brand/10 ring-2 ring-brand" : "hover:bg-slate-100"}`}
                      onClick={() => {
                        onSelect({ studentId: r.studentId, assessmentId: c.assessmentId });
                      }}
                    >
                      <CellText cell={cell} />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellText({ cell }: { cell: Cell | undefined }) {
  if (cell === undefined || (cell.score === null && cell.status !== "EXCUSED"))
    return <span className="text-slate-400">–</span>;
  if (cell.status === "EXCUSED") return <span className="text-slate-600">Excused</span>;
  return (
    <span>
      {cell.score}
      {cell.status === "DRAFT" ? <span className="ml-1 text-xs text-amber-700">draft</span> : null}
    </span>
  );
}

function ReleaseButton({ column: c, offeringId }: { column: GradebookColumn; offeringId: string }) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  if (c.unreleased === 0)
    return c.released > 0 ? <div className="font-normal text-green-700">Released</div> : null;
  return (
    <div className="font-normal">
      <button
        type="button"
        disabled={busy}
        className="text-brand underline disabled:opacity-60"
        aria-label={`Release ${String(c.unreleased)} grades for ${c.title}`}
        onClick={() =>
          void run(async () => {
            await api<typeof assessment.releaseGrades>("POST", "/assessments/:id/release", {
              params: { id: c.assessmentId },
              headers: { "idempotency-key": crypto.randomUUID() },
            });
            await queryClient.invalidateQueries({ queryKey: gradebookKey(offeringId) });
          })
        }
      >
        Release {c.unreleased}
      </button>
      {error ? <div className="text-red-700">{error}</div> : null}
    </div>
  );
}

function EditGrade({
  offeringId,
  row,
  column,
  cell,
  onClose,
}: {
  offeringId: string;
  row: GradebookRow;
  column: GradebookColumn;
  cell: Cell | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  const [excused, setExcused] = useState(cell?.status === "EXCUSED");
  const [saved, setSaved] = useState(false);
  const id = useId();
  const released = cell?.status === "RELEASED";
  return (
    <form
      // Remounts with the stored values after each save.
      key={cell?.version ?? 0}
      aria-label="Edit grade"
      className="space-y-2 rounded border border-slate-200 bg-white p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const score = formText(data, "score").trim();
        const feedback = formText(data, "feedback").trim();
        const reason = formText(data, "reason").trim();
        setSaved(false);
        void run(async () => {
          await api<typeof assessment.putGrade>("PUT", "/assessments/:id/grades/:studentId", {
            params: { id: column.assessmentId, studentId: row.studentId },
            body: {
              score: excused || score === "" ? null : score,
              feedbackMd: feedback === "" ? null : feedback,
              excused,
              ...(reason === "" ? {} : { reason }),
            },
            headers: { "if-match": `"${String(cell?.version ?? 0)}"` },
          });
          await queryClient.invalidateQueries({ queryKey: gradebookKey(offeringId) });
          setSaved(true);
        });
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">
          {row.studentName}: {column.title}
        </h3>
        <button type="button" className="text-brand underline" onClick={onClose}>
          Close
        </button>
      </div>
      {cell !== undefined ? (
        <p className="text-slate-600">
          {cell.status === "RELEASED"
            ? "Released to the student"
            : cell.status === "EXCUSED"
              ? "Excused"
              : "Draft: not released yet"}
          {cell.source === "IMPORT"
            ? " · imported"
            : cell.source === "QUIZ"
              ? " · from the quiz"
              : ""}
        </p>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={excused}
          onChange={(e) => {
            setExcused(e.target.checked);
          }}
        />
        Excused (left out of the final result)
      </label>
      {excused ? null : (
        <label className="block" htmlFor={`${id}-score`}>
          <span className="block font-medium text-slate-700">Score (out of {column.maxScore})</span>
          <input
            id={`${id}-score`}
            name="score"
            inputMode="decimal"
            defaultValue={cell?.score ?? ""}
            className={`w-32 ${input}`}
            aria-invalid={fieldErrors.score === undefined ? undefined : true}
          />
        </label>
      )}
      <label className="block">
        <span className="block font-medium text-slate-700">Feedback</span>
        <textarea
          name="feedback"
          rows={3}
          defaultValue={cell?.feedbackMd ?? ""}
          className={`block w-full ${input}`}
        />
      </label>
      {released ? (
        <label className="block">
          <span className="block font-medium text-slate-700">
            Reason for changing a released grade
          </span>
          <input
            name="reason"
            maxLength={500}
            className={`block w-full ${input}`}
            aria-invalid={fieldErrors.reason === undefined ? undefined : true}
          />
        </label>
      ) : null}
      <button type="submit" disabled={busy} className={button}>
        Save grade
      </button>
      {saved ? <span className="ml-2 text-green-700">Saved</span> : null}
    </form>
  );
}

function Columns({ offeringId, columns }: { offeringId: string; columns: GradebookColumn[] }) {
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  const [formKey, setFormKey] = useState(0);
  return (
    <details className="rounded border border-slate-200 bg-white p-3 text-sm">
      <summary className="cursor-pointer font-medium">Columns and weights</summary>
      <ul className="mt-2 space-y-2">
        {columns.map((c) => (
          <ColumnWeight
            key={`${c.assessmentId}:${String(c.version)}`}
            offeringId={offeringId}
            column={c}
          />
        ))}
      </ul>
      <form
        key={formKey}
        aria-label="Add a column"
        className="mt-3 space-y-2 border-t border-slate-100 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          void run(async () => {
            await api<typeof assessment.createGradebookColumn>(
              "POST",
              "/course-offerings/:id/assessments",
              {
                params: { id: offeringId },
                body: {
                  title: formText(data, "title"),
                  maxScore: formText(data, "maxScore"),
                  weight: formText(data, "weight"),
                },
                headers: { "idempotency-key": crypto.randomUUID() },
              },
            );
            await queryClient.invalidateQueries({ queryKey: gradebookKey(offeringId) });
            setFormKey((k) => k + 1);
          });
        }}
      >
        <h3 className="font-medium">Add a column for marks entered by hand</h3>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <label className="block">
          <span className="block text-slate-700">Title</span>
          <input name="title" required maxLength={200} className={`block w-full ${input}`} />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="block">
            <span className="block text-slate-700">Out of</span>
            <input
              name="maxScore"
              required
              inputMode="decimal"
              className={`w-24 ${input}`}
              aria-invalid={fieldErrors.maxScore === undefined ? undefined : true}
            />
          </label>
          <label className="block">
            <span className="block text-slate-700">Weight (%)</span>
            <input
              name="weight"
              required
              inputMode="decimal"
              className={`w-24 ${input}`}
              aria-invalid={fieldErrors.weight === undefined ? undefined : true}
            />
          </label>
        </div>
        <button type="submit" disabled={busy} className={button}>
          Add column
        </button>
      </form>
    </details>
  );
}

function ColumnWeight({ offeringId, column: c }: { offeringId: string; column: GradebookColumn }) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  return (
    <li>
      <form
        className="flex flex-wrap items-end gap-2"
        aria-label={`Weight of ${c.title}`}
        onSubmit={(e) => {
          e.preventDefault();
          const weight = formText(new FormData(e.currentTarget), "weight");
          void run(async () => {
            await api<typeof assessment.updateGradebookColumn>("PATCH", "/assessments/:id", {
              params: { id: c.assessmentId },
              body: { weight },
              headers: { "if-match": `"${String(c.version)}"` },
            });
            await queryClient.invalidateQueries({ queryKey: gradebookKey(offeringId) });
          });
        }}
      >
        <label className="block">
          <span className="block text-slate-700">{c.title}: weight (%)</span>
          <input
            name="weight"
            defaultValue={c.weight}
            inputMode="decimal"
            className={`w-24 ${input}`}
          />
        </label>
        <button type="submit" disabled={busy} className="rounded border border-slate-300 px-3 py-2">
          Save
        </button>
        {error ? <span className="text-red-700">{error}</span> : null}
      </form>
    </li>
  );
}

function ImportGrades({ offeringId, columns }: { offeringId: string; columns: GradebookColumn[] }) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const [checked, setChecked] = useState<{
    assessmentId: string;
    csv: string;
    result: ImportResult;
  } | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  if (columns.length === 0) return null;
  return (
    <details className="rounded border border-slate-200 bg-white p-3 text-sm">
      <summary className="cursor-pointer font-medium">Import scores from CSV</summary>
      <p className="mt-2 text-slate-600">
        One line per student with the columns <code>matric_number</code>, <code>score</code> and
        optionally <code>feedback</code>. We check the file first; nothing is saved if any line has
        a problem.
      </p>
      <form
        aria-label="Import scores"
        className="mt-2 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const file = data.get("file");
          const assessmentId = formText(data, "assessmentId");
          setChecked(null);
          setDone(null);
          void run(async () => {
            if (!(file instanceof File)) return;
            const csv = await file.text();
            const result = await runImport(offeringId, { assessmentId, csv, dryRun: true });
            setChecked({ assessmentId, csv, result });
          });
        }}
      >
        <label className="block">
          <span className="block text-slate-700">Column</span>
          <select name="assessmentId" className={`block w-full ${input}`}>
            {columns.map((c) => (
              <option key={c.assessmentId} value={c.assessmentId}>
                {c.title} (out of {c.maxScore})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-slate-700">CSV file</span>
          <input name="file" type="file" accept=".csv,text/csv" required className="block w-full" />
        </label>
        <button type="submit" disabled={busy} className={button}>
          Check file
        </button>
      </form>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {checked !== null ? (
        <div className="mt-3 space-y-2">
          <p>
            {checked.result.created} new, {checked.result.updated} changed,{" "}
            {checked.result.unchanged} unchanged, {checked.result.errors} with problems.
          </p>
          <ul className="space-y-1">
            {checked.result.rows
              .filter((r) => r.outcome === "error")
              .map((r) => (
                <li key={r.line} className="text-red-700">
                  Line {r.line} ({r.matricNumber || "no Matric Number"}): {r.message}
                </li>
              ))}
          </ul>
          {checked.result.errors === 0 && checked.result.created + checked.result.updated > 0 ? (
            <button
              type="button"
              disabled={busy}
              className={button}
              onClick={() =>
                void run(async () => {
                  const result = await runImport(offeringId, {
                    assessmentId: checked.assessmentId,
                    csv: checked.csv,
                    dryRun: false,
                  });
                  setChecked(null);
                  setDone(result);
                  await queryClient.invalidateQueries({ queryKey: gradebookKey(offeringId) });
                })
              }
            >
              Import {checked.result.created + checked.result.updated} scores
            </button>
          ) : null}
        </div>
      ) : null}
      {done !== null ? (
        <Alert tone={done.applied ? "success" : "error"}>
          {done.applied
            ? `Imported ${String(done.created + done.updated)} scores. Release the column when you're ready.`
            : "Nothing was imported: the file changed or has problems. Check it again."}
        </Alert>
      ) : null}
    </details>
  );
}
