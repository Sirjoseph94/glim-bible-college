import type { assessment, Submission, SubmissionForGrading } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { errorText } from "../api/error-copy";
import { meQuery } from "../api/session";
import { PageHeader } from "../components/app/page-header";
import { isNotAvailable, LoadFailed, NotAvailable } from "../components/app/page-states";
import { useDetailBar } from "../components/app/shell-parts";
import { formText } from "../components/form";
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
import { queueWork, useQueued } from "../offline";

/** §10.3: drafts save 5–10 s after the last keystroke, and when the page is hidden. */
const AUTOSAVE_MS = 5000;

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

/** The queue group for an assignment's submissions (its "waiting to send" pill). */
const queueGroup = (assignmentId: string) => `assignment:${assignmentId}`;

const clockTime = (when: Date, zone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(
    when,
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
  useDetailBar(
    assignment.data
      ? {
          back: {
            to: "/courses/$offeringId",
            params: { offeringId: assignment.data.courseOfferingId },
            label: "Course",
          },
        }
      : { back: { to: "/courses", label: "My courses" } },
  );
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const zone = useRef("Africa/Lagos");
  zone.current = me.data?.user.timezone ?? "Africa/Lagos";
  const queued = useQueued(queueGroup(id));
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  // A fresh editor after a queued submission is sent, so the next attempt starts empty.
  const [editorKey, setEditorKey] = useState(0);
  const [resubmitting, setResubmitting] = useState(false);

  // When queued work for this assignment is sent (or refused), say so once and refresh (§9.20).
  // This lives on the page: the editor goes away once the work is in.
  const { last } = queued;
  const handled = useRef<typeof last>(null);
  useEffect(() => {
    if (last === null || handled.current === last) return undefined;
    handled.current = last;
    const refused = last.rejected[0];
    if (last.sent.length > 0) {
      writeLocalDraft(id, null);
      setEditorKey((k) => k + 1);
      setResubmitting(false);
      setNotice({
        tone: "success",
        text: `Sent. Your assignment was submitted at ${clockTime(new Date(), zone.current)}.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["assignment", id, "mine"] });
      const timer = window.setTimeout(() => {
        setNotice(null);
      }, 4000);
      return () => {
        window.clearTimeout(timer);
      };
    }
    if (refused) setNotice({ tone: "danger", text: errorText(refused.error) });
    return undefined;
  }, [last, id, queryClient]);

  if (assignment.isPending)
    return (
      <SkeletonGroup label="Loading the assignment">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40" />
      </SkeletonGroup>
    );
  if (assignment.isError)
    return isNotAvailable(assignment.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="this assignment" onRetry={() => void assignment.refetch()} />
    );
  const a = assignment.data;
  const attempts = mine.data?.attempts ?? [];
  const submitted = attempts.filter((s) => s.status !== "DRAFT");
  const draft = attempts.find((s) => s.status === "DRAFT") ?? null;
  const due = dueState(a.dueAt, a.closesAt, new Date());
  // After a submission the form gives way to it (§11.5); Resubmit brings the form back.
  const showEditor =
    mine.data?.open === true &&
    (submitted.length === 0 || draft !== null || resubmitting || queued.count > 0);
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
                  Submitted <Time value={s.submittedAt} /> · Attempt {s.attemptNo} of{" "}
                  {a.maxAttempts}
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
      {showEditor && mine.data ? (
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
      ) : mine.data?.open === true ? (
        <Button
          variant="secondary"
          onClick={() => {
            setResubmitting(true);
          }}
        >
          Resubmit
        </Button>
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
  const me = useQuery(meQuery);
  const zone = me.data?.user.timezone ?? "Africa/Lagos";
  const { busy, problem, run } = useSubmit();
  const [text, setText] = useState(() => readLocalDraft(assignmentId) ?? draft?.textBody ?? "");
  const [saved, setSaved] = useState<{ state: "saving" | "server" | "phone"; at: Date } | null>(
    null,
  );
  const [progress, setProgress] = useState<number | null>(null);
  // Set the moment work is queued, so a second tap can't queue it again before the count updates.
  const [queuedHere, setQueuedHere] = useState(false);
  const locked = queuedHere || queuedCount > 0;
  const lastSaved = useRef(draft?.textBody ?? "");
  const pending = useRef<number | undefined>(undefined);
  // The one draft save in flight; a submit waits for it so an old save can't land after it.
  const inflight = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(text);
  latest.current = text;
  // One key per submission, so a retry or a queued replay is applied once.
  const key = useRef(crypto.randomUUID());
  const mineKey = ["assignment", assignmentId, "mine"];

  const saveDraftText = (body: { textBody?: string; fileIds?: string[] }) => {
    const request = inflight.current
      .catch(() => undefined)
      .then(() =>
        api<typeof assessment.saveDraft>("PUT", "/assignments/:id/my-submissions/draft", {
          params: { id: assignmentId },
          body,
        }),
      );
    inflight.current = request;
    return request;
  };

  const autosave = () => {
    window.clearTimeout(pending.current);
    pending.current = undefined;
    const value = latest.current;
    if (value === lastSaved.current || locked) return;
    setSaved({ state: "saving", at: new Date() });
    saveDraftText({ textBody: value })
      .then(() => {
        lastSaved.current = value;
        setSaved({ state: "server", at: new Date() });
      })
      .catch(() => {
        setSaved({ state: "phone", at: new Date() });
      });
  };
  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;

  // Typing: on this phone at once, on the server five seconds after the last keystroke.
  useEffect(() => {
    if (text === lastSaved.current) return;
    writeLocalDraft(assignmentId, text);
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      autosaveRef.current();
    }, AUTOSAVE_MS);
  }, [text, assignmentId]);

  // Leaving the page or the app: save now (§10.3).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") autosaveRef.current();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.clearTimeout(pending.current);
    };
  }, []);

  /** Queues what the server hasn't confirmed: the draft text (unless saved) and the submit. */
  const queue = async (draftConfirmed: boolean) => {
    setQueuedHere(true);
    await queueWork({
      key: key.current,
      group: queueGroup(assignmentId),
      steps: [
        ...(acceptsText && !draftConfirmed
          ? [
              {
                method: "PUT" as const,
                path: "/assignments/:id/my-submissions/draft",
                params: { id: assignmentId },
                body: { textBody: latest.current },
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
  };

  const submit = async () => {
    window.clearTimeout(pending.current);
    pending.current = undefined;
    if (!online) {
      await queue(false);
      return;
    }
    let draftConfirmed = !acceptsText;
    try {
      await inflight.current.catch(() => undefined);
      if (acceptsText) {
        if (latest.current !== lastSaved.current) await saveDraftText({ textBody: latest.current });
        lastSaved.current = latest.current;
        draftConfirmed = true;
      }
      await api<typeof assessment.submitDraft>("POST", "/assignments/:id/my-submissions/submit", {
        params: { id: assignmentId },
        headers: { "idempotency-key": key.current },
      });
    } catch (error) {
      // No answer from the server: keep what it hasn't confirmed and send it later, with the
      // same key, so a submit that did arrive isn't applied twice (§10.4).
      if (error instanceof ApiError) throw error;
      await queue(draftConfirmed);
      return;
    }
    writeLocalDraft(assignmentId, null);
    setText("");
    lastSaved.current = "";
    setSaved(null);
    key.current = crypto.randomUUID();
    await queryClient.invalidateQueries({ queryKey: mineKey });
  };

  const files = draft?.files ?? [];
  const words = wordCount(text);
  const status = locked
    ? "Your submission is saved on this phone and will send when you reconnect."
    : saved === null
      ? null
      : {
          saving: "Saving…",
          server: `Draft saved at ${clockTime(saved.at, zone)}`,
          phone: "Saved on this phone. It will save to the college when you reconnect.",
        }[saved.state];
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
          readOnly={locked}
          hint={
            locked
              ? "This answer is waiting to send, so it can't change now."
              : words === 1
                ? "1 word"
                : `${String(words)} words`
          }
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
              disabled={locked}
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
                  await saveDraftText({ fileIds: [...files.map((f) => f.id), fileId] });
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
            if (locked) return; // already waiting to send
            void run(submit);
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
  useDetailBar(
    assignment.data
      ? {
          back: {
            to: "/teach/$offeringId",
            params: { offeringId: assignment.data.courseOfferingId },
            search: { tab: "work" },
            label: "Work",
          },
        }
      : { back: { to: "/teach", label: "Teaching" } },
  );
  if (list.isPending || assignment.isPending)
    return (
      <SkeletonGroup label="Loading the submissions">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40" />
      </SkeletonGroup>
    );
  if (assignment.isError)
    return isNotAvailable(assignment.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="this assignment" onRetry={() => void assignment.refetch()} />
    );
  if (list.isError)
    return isNotAvailable(list.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="the submissions" onRetry={() => void list.refetch()} />
    );
  const a = assignment.data;
  const items = list.data.items;
  const submitted = items.filter((item) => item.latest !== null).length;
  return (
    <div className="space-y-5">
      <PageHeader
        title={`Grade: ${a.title}`}
        meta={
          <>
            Out of {a.maxScore} · {submitted} of {items.length} submitted. Grades stay hidden from
            students until you release them in the gradebook.
          </>
        }
      />
      {items.length === 0 ? (
        <EmptyState icon="users" title="No students yet">
          Students registered on the course appear here.
        </EmptyState>
      ) : (
        <Card list role="list">
          {items.map((item) => (
            <GradeRow
              key={item.studentId}
              item={item}
              assessmentId={a.assessmentId}
              maxScore={a.maxScore}
              listKey={["assignment", id, "submissions"]}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

/** The submission's state and the grade's, as words (§9.3). */
function GradeBadges({ item }: { item: SubmissionForGrading }) {
  const s = item.latest;
  return (
    <div className="flex flex-wrap gap-2">
      {s === null ? (
        <Badge tone="neutral">Not submitted</Badge>
      ) : s.isLate ? (
        <Badge tone="warning">Late</Badge>
      ) : (
        <Badge tone="info">Submitted</Badge>
      )}
      {item.grade?.status === "RELEASED" ? (
        <Badge tone="success">Released</Badge>
      ) : item.grade?.status === "EXCUSED" ? (
        <Badge status="excused" />
      ) : item.grade !== null && item.grade.score !== null ? (
        <Badge tone="brand">Graded</Badge>
      ) : null}
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
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [done, setDone] = useState(false);
  const s = item.latest;
  return (
    <div role="listitem" aria-label={item.studentName} className="space-y-3 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-subhead text-ink">{item.studentName}</p>
          {item.matricNumber === null ? null : (
            <p className="font-mono text-code text-ink-muted">{item.matricNumber}</p>
          )}
        </div>
        <GradeBadges item={item} />
      </div>
      {s === null ? null : (
        <div className="space-y-2">
          <p className="text-meta text-ink-muted">
            Attempt {s.attemptNo} of {item.submittedAttempts}, <Time value={s.submittedAt} />
            {s.isLate ? (
              <span className="text-warning">
                {" "}
                · {item.daysLate} day{item.daysLate === 1 ? "" : "s"} late
                {item.suggestedPenaltyPercent > 0
                  ? ` (policy suggests −${String(item.suggestedPenaltyPercent)}%)`
                  : ""}
              </span>
            ) : null}
          </p>
          {s.textBody === null ? null : (
            <p className="rounded-md bg-surface-sunken p-3 text-body whitespace-pre-wrap">
              {s.textBody}
            </p>
          )}
          <SubmissionFiles submission={s} />
        </div>
      )}
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      <form
        // Remounts with the stored values after each save (e.g. "18.5" shows as "18.50").
        key={item.grade?.version ?? 0}
        className="space-y-4"
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
        <TextField
          name="score"
          inputMode="decimal"
          label={`Score (out of ${maxScore})`}
          defaultValue={item.grade?.score ?? ""}
          className="max-w-40"
          error={fieldErrors.score}
        />
        <TextField
          name="feedback"
          label="Feedback"
          multiline
          rows={3}
          defaultValue={item.grade?.feedbackMd ?? ""}
          error={fieldErrors.feedbackMd}
        />
        {item.grade?.status === "RELEASED" ? (
          <TextField
            name="reason"
            label="Reason for changing a released grade"
            maxLength={500}
            error={fieldErrors.reason}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={busy}>
            Save grade
          </Button>
          {done ? (
            <span role="status" className="flex items-center gap-1 text-body-sm text-success">
              <Icon name="check" size={16} />
              Saved
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
