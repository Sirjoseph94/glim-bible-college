import type {
  assessment,
  Gradebook as GradebookData,
  GradebookColumn,
  GradebookRow,
} from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { api, ApiError } from "../api/client";
import { errorText } from "../api/error-copy";
import { LoadFailed } from "../components/app/page-states";
import { formText } from "../components/form";
import { useSubmit } from "../components/use-submit";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
import { Checkbox } from "../components/ui/choice";
import {
  bodyCell,
  DataTable,
  headCell,
  numericCell,
  stickyCell,
} from "../components/ui/data-table";
import { Sheet } from "../components/ui/dialog";
import { Select, TextField } from "../components/ui/field";
import { IconButton } from "../components/ui/icon-button";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { cn } from "../design/cn";
import { Icon } from "../design/icons";

const gradebookKey = (offeringId: string) => ["gradebook", offeringId];

type Cell = GradebookRow["grades"][number];
type ImportResult = Awaited<ReturnType<typeof runImport>>;
interface Address {
  studentId: string;
  assessmentId: string;
}

const sameCell = (a: Address | null, b: Address) =>
  a !== null && a.studentId === b.studentId && a.assessmentId === b.assessmentId;

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
 * Why a cell can't be changed inline: a released grade or a choice between an online and a typed
 * score needs a reason (C-34), and an excused one is changed in the Sheet. Null when it can.
 */
function needsDetails(row: GradebookRow, column: GradebookColumn, cell: Cell | undefined): boolean {
  const online = row.onlineScores.some((o) => o.assessmentId === column.assessmentId);
  return (
    cell?.status === "RELEASED" ||
    cell?.status === "EXCUSED" ||
    cell?.source === "QUIZ" ||
    (online && cell?.score != null)
  );
}

/**
 * A course's gradebook (TRD §14.2; handoff §9.19, §11.9): a column per assessment, a row per
 * student, the student column fixed while the rest scroll. A score is typed in its cell: Enter
 * saves and moves down, Tab saves and moves right, Escape cancels. Feedback, excusing and
 * changes that need a reason open the cell's Sheet. Students see a grade once its column is
 * released.
 */
export function Gradebook({ offeringId }: { offeringId: string }) {
  const book = useQuery({
    queryKey: gradebookKey(offeringId),
    queryFn: ({ signal }) =>
      api<typeof assessment.getGradebook>("GET", "/course-offerings/:id/gradebook", {
        params: { id: offeringId },
        signal,
      }),
  });
  const [details, setDetails] = useState<Address | null>(null);
  const [sheet, setSheet] = useState<"import" | "columns" | null>(null);
  if (book.isPending)
    return (
      <SkeletonGroup label="Loading the gradebook">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-60" />
      </SkeletonGroup>
    );
  if (book.isError) return <LoadFailed what="the gradebook" onRetry={() => void book.refetch()} />;
  const g = book.data;
  const row = g.rows.find((r) => r.studentId === details?.studentId);
  const column = g.columns.find((c) => c.assessmentId === details?.assessmentId);
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <h2 className="text-heading md:mr-auto">Gradebook</h2>
        <Button
          variant="secondary"
          onClick={() => {
            setSheet("columns");
          }}
        >
          Columns and weights
        </Button>
        {g.columns.length > 0 ? (
          <Button
            variant="secondary"
            icon="upload"
            onClick={() => {
              setSheet("import");
            }}
          >
            Import scores (CSV)
          </Button>
        ) : null}
        <Link
          to="/course-results/$offeringId"
          params={{ offeringId }}
          className={buttonClass({ variant: "primary" })}
        >
          Finalize results
        </Link>
      </div>
      {g.weightsValid ? (
        <Banner tone="info">
          Students see a grade only after you release its column. Published columns' weights add up
          to 100 %.
        </Banner>
      ) : (
        <Banner tone="warning" title={`Weights add up to ${g.weightTotal} %`}>
          Published columns' weights must add up to exactly 100 % before results can be finalized.
        </Banner>
      )}
      {g.columns.length === 0 ? (
        <p className="text-body-sm text-ink-muted">
          No columns yet: add assignments or quizzes, or a column under Columns and weights.
        </p>
      ) : (
        <GradeTable
          gradebook={g}
          offeringId={offeringId}
          onDetails={(address) => {
            setDetails(address);
          }}
        />
      )}
      <p className="text-meta text-ink-muted">
        {g.rows.length === 1 ? "1 student" : `${String(g.rows.length)} students`}. Every change is
        logged with your name and the time.
      </p>
      <Sheet
        open={row !== undefined && column !== undefined}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
        title={row && column ? `${row.studentName}: ${column.title}` : "Edit grade"}
      >
        {row !== undefined && column !== undefined ? (
          <EditGrade
            key={`${row.studentId}:${column.assessmentId}`}
            offeringId={offeringId}
            row={row}
            column={column}
            cell={row.grades.find((x) => x.assessmentId === column.assessmentId)}
          />
        ) : null}
      </Sheet>
      <Sheet
        open={sheet === "columns"}
        onOpenChange={(open) => {
          setSheet(open ? "columns" : null);
        }}
        title="Columns and weights"
      >
        <Columns
          offeringId={offeringId}
          columns={g.columns}
          onAdded={() => {
            setSheet(null);
          }}
        />
      </Sheet>
      <Sheet
        open={sheet === "import"}
        onOpenChange={(open) => {
          setSheet(open ? "import" : null);
        }}
        title="Import scores (CSV)"
      >
        <ImportGrades offeringId={offeringId} columns={g.columns} />
      </Sheet>
    </div>
  );
}

type CellState = { saving: true } | { saved: true } | { error: string; draft: string };

function GradeTable({
  gradebook: g,
  offeringId,
  onDetails,
}: {
  gradebook: GradebookData;
  offeringId: string;
  onDetails: (address: Address) => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Address | null>(null);
  const [states, setStates] = useState<Record<string, CellState>>({});
  const keyOf = (a: Address) => `${a.studentId}:${a.assessmentId}`;
  const setState = (a: Address, state: CellState | null) => {
    setStates((current) => {
      const rest = Object.fromEntries(Object.entries(current).filter(([k]) => k !== keyOf(a)));
      return state === null ? rest : { ...rest, [keyOf(a)]: state };
    });
  };

  async function save(row: GradebookRow, column: GradebookColumn, value: string) {
    const address = { studentId: row.studentId, assessmentId: column.assessmentId };
    const cell = row.grades.find((x) => x.assessmentId === column.assessmentId);
    const score = value.trim();
    if (score === (cell?.score ?? "")) return;
    setState(address, { saving: true });
    try {
      await api<typeof assessment.putGrade>("PUT", "/assessments/:id/grades/:studentId", {
        params: { id: column.assessmentId, studentId: row.studentId },
        body: { score: score === "" ? null : score },
        headers: { "if-match": `"${String(cell?.version ?? 0)}"` },
      });
      await queryClient.invalidateQueries({ queryKey: gradebookKey(offeringId) });
      setState(address, { saved: true });
      window.setTimeout(() => {
        setStates((current) =>
          "saved" in (current[keyOf(address)] ?? {})
            ? Object.fromEntries(Object.entries(current).filter(([k]) => k !== keyOf(address)))
            : current,
        );
      }, 1000);
    } catch (error) {
      const fields = error instanceof ApiError ? error.fieldErrors : {};
      setState(address, { error: fields.score ?? errorText(error), draft: score });
      setEditing(address);
      if (error instanceof ApiError && error.status === 412)
        await queryClient.invalidateQueries({ queryKey: gradebookKey(offeringId) });
    }
  }

  /** The cell `by` rows down or `across` columns right, wrapping to the next row. */
  function neighbour(from: Address, move: "down" | "right"): Address | null {
    const r = g.rows.findIndex((x) => x.studentId === from.studentId);
    const c = g.columns.findIndex((x) => x.assessmentId === from.assessmentId);
    const [nr, nc] =
      move === "down" ? [r + 1, c] : c + 1 < g.columns.length ? [r, c + 1] : [r + 1, 0];
    const row = g.rows[nr];
    const column = g.columns[nc];
    return row && column ? { studentId: row.studentId, assessmentId: column.assessmentId } : null;
  }

  return (
    <DataTable caption="Gradebook" minWidth="min-w-205">
      <thead>
        <tr>
          <th scope="col" className={cn(headCell, stickyCell, "bg-surface-sunken")}>
            Student
          </th>
          {g.columns.map((c) => (
            <th key={c.assessmentId} scope="col" className={cn(headCell, "min-w-32")}>
              <span className="block text-ink">{c.title}</span>
              <span className="block font-normal">
                / {c.maxScore} · {c.weight} %{c.status === "DRAFT" ? " · draft" : ""}
              </span>
              <ReleaseButton column={c} offeringId={offeringId} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {g.rows.map((r) => (
          <tr key={r.studentId}>
            <th scope="row" className={cn(bodyCell, stickyCell, "text-left font-normal")}>
              <span className="block text-subhead">{r.studentName}</span>
              <span className="block text-meta text-ink-muted">
                {[r.matricNumber, r.studyMode === "ONLINE" ? "Online" : "On campus"]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </th>
            {g.columns.map((c) => {
              const address = { studentId: r.studentId, assessmentId: c.assessmentId };
              const cell = r.grades.find((x) => x.assessmentId === c.assessmentId);
              const state = states[keyOf(address)];
              const label = `${r.studentName}, ${c.title}`;
              return (
                <td key={c.assessmentId} className={cn(bodyCell, numericCell, "py-1.5")}>
                  {sameCell(editing, address) ? (
                    <InlineScore
                      label={label}
                      initial={state && "draft" in state ? state.draft : (cell?.score ?? "")}
                      error={state && "error" in state ? state.error : null}
                      onDetails={() => {
                        setEditing(null);
                        onDetails(address);
                      }}
                      onCancel={() => {
                        setEditing(null);
                        setState(address, null);
                      }}
                      onCommit={(value, move) => {
                        setEditing(move ? neighbour(address, move) : null);
                        void save(r, c, value);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      aria-label={label}
                      className="flex min-h-tap w-full items-center justify-end gap-1 rounded-sm px-2 hover:bg-brand-soft"
                      onClick={() => {
                        if (needsDetails(r, c, cell)) onDetails(address);
                        else setEditing(address);
                      }}
                    >
                      <CellText cell={cell} />
                      {state && "saving" in state ? (
                        <span className="glim-spinner size-4 rounded-pill border-2 border-line border-t-brand" />
                      ) : state && "saved" in state ? (
                        <span className="text-success">
                          <Icon name="check" size={16} label="Saved" />
                        </span>
                      ) : null}
                    </button>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/** The score input inside a cell: 16 px text so phones don't zoom (§9.19). */
function InlineScore({
  label,
  initial,
  error,
  onCommit,
  onCancel,
  onDetails,
}: {
  label: string;
  initial: string;
  error: string | null;
  onCommit: (value: string, move: "down" | "right" | null) => void;
  onCancel: () => void;
  onDetails: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const errorId = useId();
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const commit = (move: "down" | "right" | null) => {
    if (done.current) return;
    done.current = true;
    onCommit(input.current?.value ?? "", move);
  };
  return (
    <div className="flex items-center justify-end gap-1">
      <IconButton icon="file" label={`Feedback and more for ${label}`} onClick={onDetails} />
      <div>
        <input
          ref={input}
          aria-label={`Score for ${label}`}
          inputMode="decimal"
          defaultValue={initial}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : errorId}
          className="h-control-sm w-20 rounded-sm border border-line-strong bg-surface px-2 text-right text-body text-ink"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit("down");
            } else if (event.key === "Tab" && !event.shiftKey) {
              event.preventDefault();
              commit("right");
            } else if (event.key === "Escape") {
              event.preventDefault();
              done.current = true;
              onCancel();
            }
          }}
          onBlur={(event) => {
            // Leaving for the cell's own "Feedback and more" button isn't a save.
            if (event.relatedTarget?.closest("td") === event.currentTarget.closest("td")) return;
            commit(null);
          }}
        />
        {error !== null ? (
          <p id={errorId} className="mt-1 text-left text-meta whitespace-normal text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CellText({ cell }: { cell: Cell | undefined }) {
  if (cell === undefined || (cell.score === null && cell.status !== "EXCUSED"))
    return <span className="text-ink-muted">–</span>;
  if (cell.status === "EXCUSED") return <span className="text-ink-muted">Excused</span>;
  return (
    <span>
      {cell.score}
      {cell.status === "DRAFT" ? (
        <span className="ml-1 text-caption text-warning">draft</span>
      ) : null}
    </span>
  );
}

function ReleaseButton({ column: c, offeringId }: { column: GradebookColumn; offeringId: string }) {
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  if (c.unreleased === 0)
    return c.released > 0 ? (
      <span className="mt-1 block font-normal text-success">Released</span>
    ) : null;
  return (
    <span className="mt-1 block font-normal">
      <Button
        size="sm"
        variant="quiet"
        loading={busy}
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
      </Button>
      {problem ? <span className="block text-danger">{problem.title}</span> : null}
    </span>
  );
}

/** Everything about one grade: score, feedback, excusing, the online score and the reason. */
function EditGrade({
  offeringId,
  row,
  column,
  cell,
}: {
  offeringId: string;
  row: GradebookRow;
  column: GradebookColumn;
  cell: Cell | undefined;
}) {
  const queryClient = useQueryClient();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [excused, setExcused] = useState(cell?.status === "EXCUSED");
  const [saved, setSaved] = useState(false);
  const released = cell?.status === "RELEASED";
  const online = row.onlineScores.find((o) => o.assessmentId === column.assessmentId);
  // Moving between the online score and one typed by hand needs a reason (C-34).
  const reasonLabel = released
    ? "Reason for changing a released grade"
    : cell?.source === "QUIZ" || (online !== undefined && cell?.score != null)
      ? "Reason for choosing this score"
      : null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: gradebookKey(offeringId) });
  return (
    <form
      // Remounts with the stored values after each save.
      key={cell?.version ?? 0}
      aria-label="Edit grade"
      className="space-y-4"
      onSubmit={(e: SubmitEvent<HTMLFormElement>) => {
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
          await refresh();
          setSaved(true);
        });
      }}
    >
      {cell !== undefined ? (
        <p className="text-body-sm text-ink-muted">
          {cell.status === "RELEASED"
            ? "Released to the student"
            : cell.status === "EXCUSED"
              ? "Excused"
              : "Draft: not released yet"}
          {cell.source === "IMPORT"
            ? " · imported"
            : cell.source === "QUIZ"
              ? column.kind === "EXAM"
                ? " · from the online exam"
                : " · from the quiz"
              : ""}
        </p>
      ) : null}
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {online !== undefined && cell?.source !== "QUIZ" ? (
        <div className="space-y-2 rounded-md bg-surface-sunken p-3">
          <p className="text-body-sm">
            Online exam score: {online.score} / {column.maxScore}
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={(e) => {
              const form = e.currentTarget.form;
              const reason = form === null ? "" : formText(new FormData(form), "reason").trim();
              setSaved(false);
              void run(async () => {
                await api<typeof assessment.useOnlineScore>(
                  "POST",
                  "/assessments/:id/grades/:studentId/online-score",
                  {
                    params: { id: column.assessmentId, studentId: row.studentId },
                    body: { reason },
                    headers: { "if-match": `"${String(cell?.version ?? 0)}"` },
                  },
                );
                await refresh();
                setSaved(true);
              });
            }}
          >
            Use the online score
          </Button>
        </div>
      ) : null}
      <Checkbox
        label="Excused (left out of the final result)"
        checked={excused}
        onChange={(e) => {
          setExcused(e.target.checked);
        }}
      />
      {excused ? null : (
        <TextField
          name="score"
          label={`Score (out of ${column.maxScore})`}
          inputMode="decimal"
          defaultValue={cell?.score ?? ""}
          className="w-32"
          error={fieldErrors.score}
        />
      )}
      <TextField
        multiline
        name="feedback"
        label="Feedback"
        optional
        rows={3}
        defaultValue={cell?.feedbackMd ?? ""}
      />
      {reasonLabel !== null ? (
        <TextField name="reason" label={reasonLabel} maxLength={500} error={fieldErrors.reason} />
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={busy}>
          Save grade
        </Button>
        <span role="status" className="text-body-sm text-success">
          {saved ? "Saved" : ""}
        </span>
      </div>
    </form>
  );
}

function Columns({
  offeringId,
  columns,
  onAdded,
}: {
  offeringId: string;
  columns: GradebookColumn[];
  onAdded: () => void;
}) {
  const queryClient = useQueryClient();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [formKey, setFormKey] = useState(0);
  return (
    <div className="space-y-5">
      {columns.length > 0 ? (
        <ul className="space-y-3">
          {columns.map((c) => (
            <ColumnWeight
              key={`${c.assessmentId}:${String(c.version)}`}
              offeringId={offeringId}
              column={c}
            />
          ))}
        </ul>
      ) : null}
      <form
        key={formKey}
        aria-label="Add a column"
        className="space-y-4 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const body = {
            title: formText(data, "title"),
            maxScore: formText(data, "maxScore"),
            weight: formText(data, "weight"),
          };
          const headers = { "idempotency-key": crypto.randomUUID() };
          void run(async () => {
            if (formText(data, "kind") === "EXAM")
              await api<typeof assessment.createExam>("POST", "/course-offerings/:id/exams", {
                params: { id: offeringId },
                body,
                headers,
              });
            else
              await api<typeof assessment.createGradebookColumn>(
                "POST",
                "/course-offerings/:id/assessments",
                { params: { id: offeringId }, body, headers },
              );
            await queryClient.invalidateQueries({ queryKey: gradebookKey(offeringId) });
            setFormKey((k) => k + 1);
            onAdded();
          });
        }}
      >
        <h3 className="text-heading">Add a column</h3>
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        <Select name="kind" label="Kind">
          <option value="MANUAL">Marks entered by hand</option>
          <option value="EXAM">Exam (on paper; add an online part under Quizzes)</option>
        </Select>
        <TextField name="title" label="Title" required maxLength={200} />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            name="maxScore"
            label="Out of"
            required
            inputMode="decimal"
            error={fieldErrors.maxScore}
          />
          <TextField
            name="weight"
            label="Weight (%)"
            required
            inputMode="decimal"
            error={fieldErrors.weight}
          />
        </div>
        <Button type="submit" variant="primary" block loading={busy}>
          Add column
        </Button>
      </form>
    </div>
  );
}

function ColumnWeight({ offeringId, column: c }: { offeringId: string; column: GradebookColumn }) {
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  return (
    <li>
      <form
        className="flex items-end gap-2"
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
        <div className="flex-1">
          <TextField
            name="weight"
            label={`${c.title}: weight (%)`}
            defaultValue={c.weight}
            inputMode="decimal"
            error={problem?.title}
          />
        </div>
        <Button type="submit" variant="secondary" loading={busy}>
          Save
        </Button>
      </form>
    </li>
  );
}

function ImportGrades({ offeringId, columns }: { offeringId: string; columns: GradebookColumn[] }) {
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  const [checked, setChecked] = useState<{
    assessmentId: string;
    csv: string;
    result: ImportResult;
  } | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-body-sm text-ink-muted">
        One line per student with the columns <code>matric_number</code>, <code>score</code> and
        optionally <code>feedback</code>. We check the file first; nothing is saved if any line has
        a problem.
      </p>
      <form
        aria-label="Import scores"
        className="space-y-4"
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
        <Select name="assessmentId" label="Column">
          {columns.map((c) => (
            <option key={c.assessmentId} value={c.assessmentId}>
              {c.title} (out of {c.maxScore})
            </option>
          ))}
        </Select>
        <label className="block space-y-1">
          <span className="text-label">CSV file</span>
          <input
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="block w-full text-body-sm"
          />
        </label>
        <Button type="submit" variant="secondary" block loading={busy}>
          Check file
        </Button>
      </form>
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {checked !== null ? (
        <div className="space-y-3">
          <p className="text-body-sm">
            {checked.result.created} new, {checked.result.updated} changed,{" "}
            {checked.result.unchanged} unchanged, {checked.result.errors} with problems.
          </p>
          <ul className="space-y-1 text-body-sm text-danger">
            {checked.result.rows
              .filter((r) => r.outcome === "error")
              .map((r) => (
                <li key={r.line}>
                  Line {r.line} ({r.matricNumber || "no Matric Number"}): {r.message}
                </li>
              ))}
          </ul>
          {checked.result.errors === 0 && checked.result.created + checked.result.updated > 0 ? (
            <Button
              variant="primary"
              block
              loading={busy}
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
            </Button>
          ) : null}
        </div>
      ) : null}
      {done !== null ? (
        <Banner tone={done.applied ? "success" : "danger"}>
          {done.applied
            ? `Imported ${String(done.created + done.updated)} scores. Release the column when you're ready.`
            : "Nothing was imported: the file changed or has problems. Check it again."}
        </Banner>
      ) : null}
    </div>
  );
}
