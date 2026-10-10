import type { assessment, Submission, SubmissionForGrading } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { describeError } from "../api/error-copy";
import { meQuery } from "../api/session";
import { PageHeader } from "../components/app/page-header";
import { useDetailBar } from "../components/app/shell-parts";
import { Alert, formText } from "../components/form";
import { Time } from "../components/time";
import { Badge } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { TextField } from "../components/ui/field";
import { OfflineBanner, QueuedPill, useOnline } from "../components/ui/offline";
import { ProgressBar } from "../components/ui/progress-bar";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { uploadFile } from "../components/upload";
import { useSubmit } from "../components/use-submit";
import { dueState, fileSize, wordCount } from "../design/format";
import { Icon } from "../design/icons";
import { offlineQueue, useQueued } from "../offline";

const AUTOSAVE_MS = 2000;

function SubmissionFiles({ submission }: { submission: Submission }) {
  if (submission.files.length === 0) return null;
  return (
    <ul className="space-y-1">
      {submission.files.map((f) => (
        <li key={f.id} className="flex items-center gap-2 text-body-sm">
          <Icon name="file" size={16} />
          <a href={f.downloadPath} className="text-brand underline">
            {f.name}
          </a>
          <span className="text-ink-muted">{fileSize(f.sizeBytes)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The draft's text, kept on this phone too, so nothing typed offline is lost (§10.3). */
function localDraftKey(assignmentId: string) {
  return `glim.draft.assignment.${assignmentId}`;
}

function readLocalDraft(assignmentId: string): string | null {
  try {
    return window.localStorage.getItem(localDraftKey(assignmentId));
  } catch {
    return null;
  }
}

function writeLocalDraft(assignmentId: string, text: string | null) {
  try {
    if (text === null) window.localStorage.removeItem(localDraftKey(assignmentId));
    else window.localStorage.setItem(localDraftKey(assignmentId), text);
  } catch {
    // Storage blocked (private mode): the server copy is the only copy.
  }
}

const clockTime = (iso: string, zone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );

/**
 * An assignment for a student (docs/ui-design-handoff.md §11.5, TRD §14.2): the instructions,
 * their attempts, and a draft that saves itself (on the server and on this phone). Submitting
 * works offline: the submission waits on the phone and sends when the connection returns
 * (§9.20, §10.4).
 */
export function AssignmentPage() {
  const { assignmentId } = useParams({ strict: false });
  const id = assignmentId ?? "";
  const online = useOnline();
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
  useDetailBar({ back: { to: "/courses", label: "My courses" } });
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const zone = me.data?.user.timezone ?? "Africa/Lagos";
  const queued = useQueued(`assignment:${id}`);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  // A fresh editor after a queued submission is sent, so the next attempt starts empty.
  const [editorKey, setEditorKey] = useState(0);

  // When queued work for this assignment is sent (or refused), say so and refresh (§9.20). This
  // lives on the page: the editor goes away once no attempts are left.
  const { last } = queued;
  useEffect(() => {
    if (last === null) return undefined;
    const refused = last.rejected[0];
    if (last.sent.length > 0) {
      writeLocalDraft(id, null);
      setEditorKey((k) => k + 1);
      setNotice({
        tone: "success",
        text: `Sent. Your assignment was submitted at ${clockTime(new Date().toISOString(), zone)}.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["assignment", id, "mine"] });
      const timer = window.setTimeout(() => {
        setNotice(null);
      }, 4000);
      return () => {
        window.clearTimeout(timer);
      };
    }
    if (refused) {
      const copy = describeError(refused.error);
      setNotice({ tone: "danger", text: copy.body ? `${copy.title}. ${copy.body}` : copy.title });
    }
    return undefined;
  }, [last, id, zone, queryClient]);

  if (assignment.isPending)
    return (
      <SkeletonGroup label="Loading the assignment">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40" />
      </SkeletonGroup>
    );
  if (assignment.isError)
    return <EmptyState icon="file" title="This assignment isn't available to you" />;
  const a = assignment.data;
  const attempts = mine.data?.attempts ?? [];
  const submitted = attempts.filter((s) => s.status !== "DRAFT");
  const draft = attempts.find((s) => s.status === "DRAFT") ?? null;
  const due = dueState(a.dueAt, a.closesAt, new Date());
  return (
    <div className="space-y-5">
      {online ? null : <OfflineBanner />}
      {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
      <PageHeader
        title={a.title}
        meta={
          <>
            Due <Time value={a.dueAt} />
            {a.closesAt !== null && a.closesAt !== a.dueAt ? (
              <>
                {" "}
                · late work until <Time value={a.closesAt} />
              </>
            ) : null}
            {" · "}
            {a.maxScore} marks ·{" "}
            {a.maxAttempts === 1 ? "1 attempt" : `${String(a.maxAttempts)} attempts`}
          </>
        }
        actions={
          due === "soon" ? (
            <Badge tone="warning">Due soon</Badge>
          ) : due === "late" || due === "closed" ? (
            <Badge tone="danger">Overdue</Badge>
          ) : undefined
        }
      />
      <div
        className="max-w-prose space-y-2 text-body [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
        // Rendered from Markdown and sanitized on the server.
        dangerouslySetInnerHTML={{ __html: a.instructionsHtml }}
      />
      {submitted.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-heading">Your submissions</h2>
          <Card list>
            {submitted.map((s) => (
              <div key={s.id} className="space-y-2 px-4 py-3.5">
                <p className="text-subhead">
                  Attempt {s.attemptNo} of {a.maxAttempts} · Submitted{" "}
                  <Time value={s.submittedAt} />
                  {s.isLate ? (
                    <>
                      {" "}
                      <Badge tone="warning">Late</Badge>
                    </>
                  ) : null}
                </p>
                {s.textBody === null ? null : (
                  <p className="text-body-sm whitespace-pre-wrap text-ink-muted">{s.textBody}</p>
                )}
                <SubmissionFiles submission={s} />
              </div>
            ))}
          </Card>
        </section>
      ) : null}
      {mine.data?.open === true ? (
        <DraftEditor
          key={editorKey}
          assignmentId={id}
          queuedCount={queued.count}
          draft={draft}
          late={due === "late"}
          acceptsText={a.submissionTypes.includes("TEXT")}
          acceptsFiles={a.submissionTypes.includes("FILE")}
          maxFileMb={a.maxFileMb}
          attemptsLeft={mine.data.attemptsLeft}
        />
      ) : mine.isSuccess ? (
        <p className="text-body-sm text-ink-muted">
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
  queuedCount,
  draft,
  late,
  acceptsText,
  acceptsFiles,
  maxFileMb,
  attemptsLeft,
}: {
  assignmentId: string;
  /** Submissions for this assignment waiting on the phone to send. */
  queuedCount: number;
  draft: Submission | null;
  late: boolean;
  acceptsText: boolean;
  acceptsFiles: boolean;
  maxFileMb: number;
  attemptsLeft: number;
}) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const { busy, problem, run } = useSubmit();
  const group = `assignment:${assignmentId}`;
  const [text, setText] = useState(() => readLocalDraft(assignmentId) ?? draft?.textBody ?? "");
  const [saved, setSaved] = useState<"saved" | "saving" | "phone" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const lastSaved = useRef(draft?.textBody ?? "");
  const mineKey = ["assignment", assignmentId, "mine"];

  // Autosave two seconds after the student stops typing: on this phone at once, then the server.
  useEffect(() => {
    if (text === lastSaved.current) return;
    writeLocalDraft(assignmentId, text);
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
          setSaved("phone");
        });
    }, AUTOSAVE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text, assignmentId]);

  // One key per submission, so a retry or a queued replay is applied once.
  const key = useRef(crypto.randomUUID());

  const submitNow = async () => {
    if (acceptsText && text !== lastSaved.current) {
      await api<typeof assessment.saveDraft>("PUT", "/assignments/:id/my-submissions/draft", {
        params: { id: assignmentId },
        body: { textBody: text },
      });
      lastSaved.current = text;
    }
    await api<typeof assessment.submitDraft>("POST", "/assignments/:id/my-submissions/submit", {
      params: { id: assignmentId },
      headers: { "idempotency-key": key.current },
    });
    writeLocalDraft(assignmentId, null);
    setText("");
    lastSaved.current = "";
    setSaved(null);
    key.current = crypto.randomUUID();
    await queryClient.invalidateQueries({ queryKey: mineKey });
  };
  const queue = async () => {
    await offlineQueue.enqueue({
      key: key.current,
      group,
      steps: [
        ...(acceptsText
          ? [
              {
                method: "PUT" as const,
                path: "/assignments/:id/my-submissions/draft",
                params: { id: assignmentId },
                body: { textBody: text },
              },
            ]
          : []),
        {
          method: "POST" as const,
          path: "/assignments/:id/my-submissions/submit",
          params: { id: assignmentId },
        },
      ],
    });
    key.current = crypto.randomUUID();
  };

  const files = draft?.files ?? [];
  const words = wordCount(text);
  const status =
    queuedCount > 0
      ? "Your submission is saved on this phone and will send when you reconnect."
      : saved === "saving"
        ? "Saving…"
        : saved === "saved"
          ? "Draft saved"
          : saved === "phone"
            ? "Saved on this phone. It will save to the college when you reconnect."
            : null;
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-heading">
          {draft === null ? "Your answer" : `Attempt ${String(draft.attemptNo)} (draft)`}
        </h2>
        <p className="text-meta text-ink-muted">
          {attemptsLeft === 1 ? "1 attempt left" : `${String(attemptsLeft)} attempts left`}
        </p>
      </div>
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {late ? (
        <Banner tone="warning" title="Submitting late">
          Your Lecturer may deduct marks.
        </Banner>
      ) : null}
      {acceptsText ? (
        <TextField
          id="answer"
          label="Answer"
          multiline
          rows={8}
          value={text}
          hint={words === 1 ? "1 word" : `${String(words)} words`}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      ) : null}
      {acceptsFiles ? (
        <div className="space-y-2">
          {files.length > 0 ? (
            <Card list>
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                  <Icon name="file" />
                  <span className="min-w-0 flex-1 truncate text-body-sm">{f.name}</span>
                  <span className="text-meta text-ink-muted">{fileSize(f.sizeBytes)}</span>
                  <Badge tone="success">Uploaded</Badge>
                </div>
              ))}
            </Card>
          ) : null}
          <label
            htmlFor="file"
            className={`${buttonClass({ variant: "secondary" })} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus`}
          >
            <Icon name="upload" />
            Attach a file (up to {maxFileMb} MB)
            <input
              id="file"
              name="file"
              type="file"
              className="sr-only"
              onChange={(e) => {
                const input = e.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                void run(async () => {
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
                  input.value = "";
                  await queryClient.invalidateQueries({ queryKey: mineKey });
                }).finally(() => {
                  setProgress(null);
                });
              }}
            />
          </label>
          {online ? null : (
            <p className="text-body-sm text-ink-muted">Files upload once you're back online.</p>
          )}
          {progress !== null ? <ProgressBar label="Uploading" value={progress * 100} /> : null}
        </div>
      ) : null}
      <div className="sticky bottom-0 z-nav -mx-4 space-y-2 border-t border-line bg-surface-raised px-4 pt-3 pb-5 shadow-sheet md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:shadow-none">
        <p className="text-body-sm text-ink-muted" aria-live="polite">
          {status}
        </p>
        <QueuedPill count={queuedCount} noun={["submission", "submissions"]} />
        <Button
          variant="primary"
          icon="upload"
          block
          loading={busy}
          onClick={() => {
            if (queuedCount > 0) return; // already waiting to send
            void run(async () => {
              if (!online) {
                await queue();
                return;
              }
              try {
                await submitNow();
              } catch (error) {
                // No answer from the server: keep the submission and send it later (§10.4).
                if (error instanceof ApiError) throw error;
                await queue();
              }
            });
          }}
        >
          Submit assignment
        </Button>
      </div>
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
