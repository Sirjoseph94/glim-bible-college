import type { assessment, Submission, SubmissionForGrading } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Alert, formText } from "../components/form";
import { Time } from "../components/time";
import { uploadFile } from "../components/upload";
import { useSubmit } from "../components/use-submit";

const AUTOSAVE_MS = 2000;

function SubmissionFiles({ submission }: { submission: Submission }) {
  if (submission.files.length === 0) return null;
  return (
    <ul className="list-disc pl-5">
      {submission.files.map((f) => (
        <li key={f.id}>
          <a href={f.downloadPath} className="text-blue-700 underline">
            {f.name}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * An assignment for a student (TRD §14.2): the instructions, their attempts, and a draft that
 * saves itself as they type, with files, until they submit.
 */
export function AssignmentPage() {
  const { assignmentId } = useParams({ strict: false });
  const id = assignmentId ?? "";
  const assignment = useQuery({
    queryKey: ["assignment", id],
    queryFn: ({ signal }) =>
      api<typeof assessment.getAssignment>("GET", "/assignments/:id", { params: { id }, signal }),
  });
  const mine = useQuery({
    queryKey: ["assignment", id, "mine"],
    queryFn: ({ signal }) =>
      api<typeof assessment.getMySubmissions>("GET", "/assignments/:id/my-submissions", {
        params: { id },
        signal,
      }),
  });
  if (assignment.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (assignment.isError)
    return <Alert tone="error">This assignment isn't available to you.</Alert>;
  const a = assignment.data;
  const attempts = mine.data?.attempts ?? [];
  const submitted = attempts.filter((s) => s.status !== "DRAFT");
  const draft = attempts.find((s) => s.status === "DRAFT") ?? null;
  return (
    <div className="space-y-4">
      <h1 className="text-title">{a.title}</h1>
      <div className="text-sm text-slate-600">
        <p>
          Due <Time value={a.dueAt} />
          {a.closesAt !== null && a.closesAt !== a.dueAt ? (
            <>
              {" "}
              · late work until <Time value={a.closesAt} />
            </>
          ) : null}
        </p>
        <p>
          {a.maxScore} marks ·{" "}
          {a.maxAttempts === 1 ? "1 attempt" : `${String(a.maxAttempts)} attempts`}
        </p>
      </div>
      <div
        className="space-y-2 rounded border border-slate-200 bg-white p-3 text-sm [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
        // Rendered from Markdown and sanitized on the server.
        dangerouslySetInnerHTML={{ __html: a.instructionsHtml }}
      />
      {submitted.length > 0 ? (
        <section className="space-y-2">
          <h3 className="font-medium">Your submissions</h3>
          <ul className="space-y-2 text-sm">
            {submitted.map((s) => (
              <li key={s.id} className="rounded border border-slate-200 bg-white p-2">
                Attempt {s.attemptNo}, submitted <Time value={s.submittedAt} />
                {s.isLate ? <span className="text-amber-700"> (late)</span> : null}
                {s.textBody === null ? null : (
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">{s.textBody}</p>
                )}
                <SubmissionFiles submission={s} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {mine.data?.open === true ? (
        <DraftEditor
          assignmentId={id}
          draft={draft}
          acceptsText={a.submissionTypes.includes("TEXT")}
          acceptsFiles={a.submissionTypes.includes("FILE")}
          maxFileMb={a.maxFileMb}
          attemptsLeft={mine.data.attemptsLeft}
        />
      ) : mine.isSuccess ? (
        <p className="text-sm text-slate-600">
          {mine.data.attemptsLeft === 0 && submitted.length > 0
            ? "You've used all your attempts."
            : "Submissions are closed."}
        </p>
      ) : null}
    </div>
  );
}

function DraftEditor({
  assignmentId,
  draft,
  acceptsText,
  acceptsFiles,
  maxFileMb,
  attemptsLeft,
}: {
  assignmentId: string;
  draft: Submission | null;
  acceptsText: boolean;
  acceptsFiles: boolean;
  maxFileMb: number;
  attemptsLeft: number;
}) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const [text, setText] = useState(draft?.textBody ?? "");
  const [saved, setSaved] = useState<"saved" | "saving" | "unsaved" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const lastSaved = useRef(draft?.textBody ?? "");
  const mineKey = ["assignment", assignmentId, "mine"];

  // Autosave: two seconds after the student stops typing.
  useEffect(() => {
    if (text === lastSaved.current) return;
    setSaved("unsaved");
    const timer = window.setTimeout(() => {
      setSaved("saving");
      api<typeof assessment.saveDraft>("PUT", "/assignments/:id/my-submissions/draft", {
        params: { id: assignmentId },
        body: { textBody: text },
      })
        .then(() => {
          lastSaved.current = text;
          setSaved("saved");
        })
        .catch(() => {
          setSaved("unsaved");
        });
    }, AUTOSAVE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text, assignmentId]);

  const files = draft?.files ?? [];
  return (
    <section className="space-y-2 rounded border border-slate-200 bg-white p-3">
      <h3 className="font-medium">
        {draft === null ? "Your answer" : `Attempt ${String(draft.attemptNo)} (draft)`}
      </h3>
      <p className="text-xs text-slate-500">
        {attemptsLeft === 1 ? "1 attempt left" : `${String(attemptsLeft)} attempts left`}
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {acceptsText ? (
        <>
          <label htmlFor="answer" className="block text-sm font-medium text-slate-700">
            Answer
          </label>
          <textarea
            id="answer"
            rows={8}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
            className="block w-full rounded border border-slate-300 px-3 py-2"
          />
          <p className="text-xs text-slate-500" aria-live="polite">
            {saved === "saving"
              ? "Saving…"
              : saved === "saved"
                ? "Draft saved"
                : saved === "unsaved"
                  ? "Not saved yet"
                  : null}
          </p>
        </>
      ) : null}
      {acceptsFiles ? (
        <form
          className="space-y-1 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const file = new FormData(e.currentTarget).get("file");
            const form = e.currentTarget;
            void run(async () => {
              if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file.");
              if (file.size > maxFileMb * 1024 * 1024)
                throw new Error(`Each file must be at most ${String(maxFileMb)} MB.`);
              setProgress(0);
              const fileId = await uploadFile(
                file,
                {
                  name: file.name,
                  mime: file.type || "application/octet-stream",
                  purpose: "SUBMISSION",
                },
                setProgress,
              );
              await api<typeof assessment.saveDraft>(
                "PUT",
                "/assignments/:id/my-submissions/draft",
                {
                  params: { id: assignmentId },
                  body: { fileIds: [...files.map((f) => f.id), fileId] },
                },
              );
              form.reset();
              await queryClient.invalidateQueries({ queryKey: mineKey });
            }).finally(() => {
              setProgress(null);
            });
          }}
        >
          {files.length > 0 ? (
            <ul className="list-disc pl-5">
              {files.map((f) => (
                <li key={f.id}>{f.name}</li>
              ))}
            </ul>
          ) : null}
          <label htmlFor="file" className="block font-medium text-slate-700">
            Add a file (up to {maxFileMb} MB)
          </label>
          <input id="file" name="file" type="file" />
          {progress !== null ? (
            <progress className="w-full" value={progress} max={1} aria-label="Upload progress" />
          ) : null}
          <button type="submit" disabled={busy} className="underline">
            Upload file
          </button>
        </form>
      ) : null}
      <button
        type="button"
        disabled={busy}
        className="w-full rounded bg-brand px-4 py-2 font-medium text-white disabled:opacity-60"
        onClick={() =>
          void run(async () => {
            if (acceptsText && text !== lastSaved.current) {
              await api<typeof assessment.saveDraft>(
                "PUT",
                "/assignments/:id/my-submissions/draft",
                {
                  params: { id: assignmentId },
                  body: { textBody: text },
                },
              );
              lastSaved.current = text;
            }
            await api<typeof assessment.submitDraft>(
              "POST",
              "/assignments/:id/my-submissions/submit",
              {
                params: { id: assignmentId },
                headers: { "idempotency-key": crypto.randomUUID() },
              },
            );
            setText("");
            lastSaved.current = "";
            setSaved(null);
            await queryClient.invalidateQueries({ queryKey: mineKey });
          })
        }
      >
        Submit
      </button>
    </section>
  );
}

/** Grading an assignment (TRD §14.2): each student's latest attempt, a score and feedback. */
export function GradeAssignmentPage() {
  const { assignmentId } = useParams({ strict: false });
  const id = assignmentId ?? "";
  const assignment = useQuery({
    queryKey: ["assignment", id],
    queryFn: ({ signal }) =>
      api<typeof assessment.getAssignment>("GET", "/assignments/:id", { params: { id }, signal }),
  });
  const list = useQuery({
    queryKey: ["assignment", id, "submissions"],
    queryFn: ({ signal }) =>
      api<typeof assessment.listSubmissions>("GET", "/assignments/:id/submissions", {
        params: { id },
        signal,
      }),
  });
  if (list.isPending || assignment.isPending)
    return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (list.isError || assignment.isError)
    return <Alert tone="error">We couldn't load the submissions.</Alert>;
  const a = assignment.data;
  return (
    <div className="space-y-4">
      <h1 className="text-title">Grade: {a.title}</h1>
      <p className="text-sm text-slate-600">
        Out of {a.maxScore}. Grades stay hidden from students until you release them in the
        gradebook.
      </p>
      <ul className="space-y-3">
        {list.data.items.map((item) => (
          <GradeRow
            key={item.studentId}
            item={item}
            assessmentId={a.assessmentId}
            maxScore={a.maxScore}
            listKey={["assignment", id, "submissions"]}
          />
        ))}
      </ul>
    </div>
  );
}

function GradeRow({
  item,
  assessmentId,
  maxScore,
  listKey,
}: {
  item: SubmissionForGrading;
  assessmentId: string;
  maxScore: string;
  listKey: string[];
}) {
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  const [done, setDone] = useState(false);
  const s = item.latest;
  return (
    <li
      className="space-y-2 rounded border border-slate-200 bg-white p-3 text-sm"
      aria-label={item.studentName}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{item.studentName}</span>
        <span className="text-slate-500">{item.matricNumber}</span>
      </div>
      {s === null ? (
        <p className="text-slate-600">Not submitted.</p>
      ) : (
        <div className="space-y-1">
          <p className="text-slate-600">
            Attempt {s.attemptNo} of {item.submittedAttempts}, <Time value={s.submittedAt} />
            {s.isLate ? (
              <span className="text-amber-700">
                {" "}
                — {item.daysLate} day{item.daysLate === 1 ? "" : "s"} late
                {item.suggestedPenaltyPercent > 0
                  ? ` (policy suggests −${String(item.suggestedPenaltyPercent)}%)`
                  : ""}
              </span>
            ) : null}
          </p>
          {s.textBody === null ? null : (
            <p className="whitespace-pre-wrap rounded bg-slate-50 p-2">{s.textBody}</p>
          )}
          <SubmissionFiles submission={s} />
        </div>
      )}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form
        // Remounts with the stored values after each save (e.g. "18.5" shows as "18.50").
        key={item.grade?.version ?? 0}
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const score = formText(data, "score").trim();
          const feedback = formText(data, "feedback").trim();
          const reason = formText(data, "reason").trim();
          setDone(false);
          void run(async () => {
            await api<typeof assessment.putGrade>("PUT", "/assessments/:id/grades/:studentId", {
              params: { id: assessmentId, studentId: item.studentId },
              body: {
                score: score === "" ? null : score,
                feedbackMd: feedback === "" ? null : feedback,
                ...(reason === "" ? {} : { reason }),
              },
              headers: { "if-match": `"${String(item.grade?.version ?? 0)}"` },
            });
            await queryClient.invalidateQueries({ queryKey: listKey });
            setDone(true);
          });
        }}
      >
        <label className="block">
          <span className="block font-medium text-slate-700">Score (out of {maxScore})</span>
          <input
            name="score"
            inputMode="decimal"
            defaultValue={item.grade?.score ?? ""}
            className="w-32 rounded border border-slate-300 px-3 py-2"
            aria-invalid={fieldErrors.score === undefined ? undefined : true}
          />
        </label>
        <label className="block">
          <span className="block font-medium text-slate-700">Feedback</span>
          <textarea
            name="feedback"
            rows={3}
            defaultValue={item.grade?.feedbackMd ?? ""}
            className="block w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>
        {item.grade?.status === "RELEASED" ? (
          <label className="block">
            <span className="block font-medium text-slate-700">
              Reason for changing a released grade
            </span>
            <input
              name="reason"
              maxLength={500}
              className="block w-full rounded border border-slate-300 px-3 py-2"
              aria-invalid={fieldErrors.reason === undefined ? undefined : true}
            />
          </label>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
        >
          Save grade
        </button>
        {done ? <span className="ml-2 text-green-700">Saved</span> : null}
      </form>
    </li>
  );
}
