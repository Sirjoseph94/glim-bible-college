import type { assessment, QuizAttempt } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../api/client";
import { describeError, type ErrorCopy } from "../api/error-copy";
import { PageHeader } from "../components/app/page-header";
import { isNotAvailable, LoadFailed, NotAvailable } from "../components/app/page-states";
import { useDetailBar } from "../components/app/shell-parts";
import { formText } from "../components/form";
import { Time } from "../components/time";
import { Badge } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card, cardClass } from "../components/ui/card";
import { Checkbox, Radio } from "../components/ui/choice";
import { ConfirmDialog } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Select, TextField } from "../components/ui/field";
import { OfflineBanner, QueuedPill, useOnline } from "../components/ui/offline";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";
import { cn } from "../design/cn";
import { Icon } from "../design/icons";
import { offlineQueue, queueWork, useQueued } from "../offline";
import {
  changedSince,
  latestSeq,
  mergeSaves,
  nextSeq,
  queuedAnswers,
  quizGroup,
  restoreAnswers,
  saveStep,
  waitingCount,
  type Answers,
  type Response,
} from "./quiz-answers";

/** Answers are gathered this long after a change, then handed to the queue as one batch. */
const AUTOSAVE_MS = 800;
/** While handing in, how often the page tries again. */
const RETRY_MS = 3000;
/** The timer turns `warning` under two minutes (§11.11). */
const WARNING_MS = 120_000;

const legacyTaken = new Map<string, Answers>();

/**
 * Answers the previous quiz page left unsent in local storage: taken over once, so they go out
 * through the queue. Kept per attempt for the page's lifetime, so a second render gets the same
 * answers rather than none, until the page has mounted (`legacyTaken.set(id, {})`).
 * (Remove after every phone has opened its quizzes since; WP-UI-12.)
 */
function takeLegacyAnswers(attemptId: string): Answers {
  const taken = legacyTaken.get(attemptId);
  if (taken !== undefined) return taken;
  const key = `glim:quiz-attempt:${attemptId}`;
  let answers: Answers = {};
  try {
    const raw = window.localStorage.getItem(key);
    window.localStorage.removeItem(key);
    if (raw !== null) answers = JSON.parse(raw) as Answers;
  } catch {
    // Storage unavailable or unreadable: nothing to take over.
  }
  legacyTaken.set(attemptId, answers);
  return answers;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  return `${String(m)}:${String(total % 60).padStart(2, "0")}`;
}

/** A quiz for a student (TRD §14.2): its attempts, and starting or carrying on with one. */
export function QuizPage() {
  const { quizId } = useParams({ strict: false });
  const id = quizId ?? "";
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const quiz = useQuery({
    queryKey: ["quiz", id],
    queryFn: ({ signal }) =>
      api<typeof assessment.getQuiz>("GET", "/quizzes/:id", { params: { id }, signal }),
  });
  const mine = useQuery({
    queryKey: ["quiz", id, "mine"],
    queryFn: ({ signal }) =>
      api<typeof assessment.getMyQuizAttempts>("GET", "/quizzes/:id/my-attempts", {
        params: { id },
        signal,
      }),
  });
  useDetailBar(
    quiz.data
      ? {
          back: {
            to: "/courses/$offeringId",
            params: { offeringId: quiz.data.courseOfferingId },
            search: { tab: "work" },
            label: "Course",
          },
        }
      : { back: { to: "/courses", label: "My courses" } },
  );
  if (quiz.isPending)
    return (
      <SkeletonGroup label="Loading the quiz">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40" />
      </SkeletonGroup>
    );
  if (quiz.isError)
    return isNotAvailable(quiz.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="this quiz" onRetry={() => void quiz.refetch()} />
    );
  const z = quiz.data;
  if (attempt !== null)
    return (
      <AttemptView
        // A finished attempt starts afresh from the server's copy.
        key={`${attempt.id}:${attempt.status}`}
        initial={attempt}
        title={z.title}
        onDone={(finished) => {
          setAttempt(finished);
          void queryClient.invalidateQueries({ queryKey: ["quiz", id, "mine"] });
        }}
      />
    );
  const running = mine.data?.attempts.find((a) => a.status === "IN_PROGRESS");
  const finished = (mine.data?.attempts ?? []).filter((a) => a.status !== "IN_PROGRESS");
  return (
    <div className="space-y-5">
      <PageHeader
        title={z.title}
        meta={
          <>
            {z.questionCount} questions · {z.maxScore} marks
            {z.timeLimitMinutes === null ? "" : ` · ${String(z.timeLimitMinutes)} minutes`} ·{" "}
            {z.maxAttempts === 1 ? "1 attempt" : `${String(z.maxAttempts)} attempts`}
            {z.closesAt === null ? null : (
              <>
                {" "}
                · closes <Time value={z.closesAt} />
              </>
            )}
          </>
        }
      />
      {z.instructionsHtml === null ? null : (
        <div
          className="max-w-prose space-y-2 text-body [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
          // Rendered from Markdown and sanitized on the server.
          dangerouslySetInnerHTML={{ __html: z.instructionsHtml }}
        />
      )}
      {finished.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-heading">Your attempts</h2>
          <Card list role="list">
            {finished.map((a) => (
              <div
                key={a.id}
                role="listitem"
                aria-label={`Attempt ${String(a.attemptNo)}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span className="text-body">
                  Attempt {a.attemptNo}:{" "}
                  {a.score === null ? (
                    <Badge tone="warning">Waiting for marking</Badge>
                  ) : (
                    <span className="font-semibold">
                      {a.score} / {z.maxScore}
                    </span>
                  )}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void run(async () => {
                      setAttempt(
                        await api<typeof assessment.getQuizAttempt>("GET", "/quiz-attempts/:id", {
                          params: { id: a.id },
                        }),
                      );
                    })
                  }
                >
                  Review
                </Button>
              </div>
            ))}
          </Card>
        </section>
      ) : null}
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {mine.isError ? (
        <LoadFailed what="your attempts" onRetry={() => void mine.refetch()} />
      ) : mine.data?.open === true ? (
        <Button
          variant="primary"
          block
          loading={busy}
          onClick={() =>
            void run(async () => {
              setAttempt(
                await api<typeof assessment.startAttempt>("POST", "/quizzes/:id/attempts", {
                  params: { id },
                }),
              );
            })
          }
        >
          {running === undefined ? "Start" : "Continue"}
          {z.timeLimitMinutes === null || running !== undefined
            ? ""
            : ` (${String(z.timeLimitMinutes)} min timer starts)`}
        </Button>
      ) : mine.isSuccess ? (
        <p className="text-body-sm text-ink-muted">
          {!mine.data.eligible
            ? "You sit this exam on paper in the Room. Ask your Lecturer if you need to take it online."
            : mine.data.attemptsLeft === 0
              ? "You've used all your attempts."
              : "This quiz isn't open now."}
        </p>
      ) : (
        <Skeleton className="h-control" />
      )}
    </div>
  );
}

/**
 * An attempt in progress or finished (§11.11): one question per screen on phones, all of them
 * from 1024px, under a sticky timer bar. Answers are gathered for a moment after each change and
 * go through the offline queue (§9.20), so answers given with no signal are kept on the phone
 * and sent on reconnect, in order, the latest answer to each question winning. At the deadline
 * the page sends what it has and submits, trying again every few seconds while offline; the
 * server accepts answers for 30 s after the deadline.
 */
function AttemptView({
  initial,
  title,
  onDone,
}: {
  initial: QuizAttempt;
  title: string;
  onDone: (attempt: QuizAttempt) => void;
}) {
  const attemptId = initial.id;
  const group = quizGroup(attemptId);
  const inProgress = initial.status === "IN_PROGRESS";
  const online = useOnline();
  const queued = useQueued(group);
  const baseId = useId();
  const [legacy] = useState<Answers>(() => (inProgress ? takeLegacyAnswers(attemptId) : {}));
  const [answers, setAnswers] = useState<Answers>(() => {
    const saved: Answers = {};
    for (const q of initial.questions) saved[q.questionId] = q.response;
    return { ...saved, ...legacy };
  });
  // Answers not yet handed to the queue; the ref is always current for timers and handing in.
  const [local, setLocalState] = useState<Answers>(legacy);
  const localRef = useRef(local);
  const setLocal = (next: Answers) => {
    localRef.current = next;
    setLocalState(next);
  };
  const setLocalRef = useRef(setLocal);
  setLocalRef.current = setLocal;
  const edited = useRef(new Set(Object.keys(legacy)));
  // Taken over now: reopening the attempt later must not bring the old answers back.
  useEffect(() => {
    if (inProgress) legacyTaken.set(attemptId, {});
  }, [attemptId, inProgress]);
  const seq = useRef(initial.lastSeq);
  const batchTimer = useRef<number | undefined>(undefined);
  const finishing = useRef(false);
  const [handingIn, setHandingIn] = useState(false);
  const [everSaved, setEverSaved] = useState(false);
  const [refused, setRefused] = useState<ErrorCopy | null>(null);
  const [index, setIndex] = useState(0);
  const moved = useRef(false);
  // The server's clock minus ours, so a phone with the wrong time still counts down correctly.
  const skew = useRef(new Date(initial.serverNow).getTime() - Date.now());
  const deadline = initial.deadlineAt === null ? null : new Date(initial.deadlineAt).getTime();
  const [left, setLeft] = useState(deadline === null ? null : deadline - Date.now() - skew.current);

  // Answers still waiting on the phone from an earlier visit: shown, and new batches go after them.
  useEffect(() => {
    if (!inProgress) return undefined;
    let live = true;
    void offlineQueue.list(group).then((items) => {
      if (!live) return;
      seq.current = latestSeq(items, seq.current);
      setAnswers((shown) => restoreAnswers(shown, queuedAnswers(items), edited.current));
    });
    return () => {
      live = false;
    };
  }, [group, inProgress]);

  const queueBatch = useCallback(
    (batch: Answers) => {
      seq.current = nextSeq(seq.current, Date.now());
      // Folded into the last unsent save, so answers made offline go back as one request.
      return queueWork(
        { key: crypto.randomUUID(), group, steps: [saveStep(attemptId, seq.current, batch)] },
        mergeSaves,
      );
    },
    [attemptId, group],
  );

  // One hand-over at a time, so a batch is never queued twice.
  const handing = useRef<Promise<void>>(Promise.resolve());
  /** Hands the answers not yet batched to the queue, as one save. */
  const handOver = useCallback(() => {
    handing.current = handing.current.then(async () => {
      window.clearTimeout(batchTimer.current);
      batchTimer.current = undefined;
      const batch = localRef.current;
      if (Object.keys(batch).length === 0) return;
      await queueBatch(batch);
      // Keep anything answered again while the batch was being stored.
      setLocalRef.current(changedSince(localRef.current, batch));
    });
    return handing.current;
  }, [queueBatch]);

  const scheduleBatch = useCallback(() => {
    if (batchTimer.current !== undefined) return;
    batchTimer.current = window.setTimeout(() => void handOver(), AUTOSAVE_MS);
  }, [handOver]);

  // Answers gathered (or taken over from the old page): hand them over now, online or not.
  useEffect(() => {
    if (Object.keys(localRef.current).length === 0) return;
    void handOver();
  }, [online, handOver]);
  // Leaving the app: keep the answers in the queue.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void handOver();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [handOver]);
  // Leaving the page with answers not yet batched: queue them now rather than lose them.
  useEffect(() => () => void handOver(), [handOver]);

  // After a send, say the answers are saved; a refused save is said once. An attempt that has
  // ended on the server has nothing more to save, which the page says by handing in.
  useEffect(() => {
    if (queued.last === null) return;
    if (queued.last.sent.length > 0) setEverSaved(true);
    const rejected = queued.last.rejected.find((r) => r.error.code !== "ATTEMPT_EXPIRED");
    if (rejected) setRefused(describeError(rejected.error));
  }, [queued.last]);

  /** Sends what's left, then submits; keeps trying while the connection is down. */
  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    setHandingIn(true);
    for (;;) {
      try {
        await handOver();
        await offlineQueue.flush();
        // A send already under way may have started before the last batch was stored.
        if ((await offlineQueue.count(group)) > 0) await offlineQueue.flush();
        if ((await offlineQueue.count(group)) > 0) throw new Error("Answers still waiting");
        const done = await api<typeof assessment.submitQuizAttempt>(
          "POST",
          "/quiz-attempts/:id/submit",
          { params: { id: attemptId }, headers: { "idempotency-key": `submit-${attemptId}` } },
        );
        onDone(done);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  }, [attemptId, group, handOver, onDone]);

  // The countdown; at zero the page hands the attempt in.
  useEffect(() => {
    if (!inProgress || deadline === null) return;
    const timer = window.setInterval(() => {
      const remaining = deadline - Date.now() - skew.current;
      setLeft(remaining);
      if (remaining <= 0) void finish();
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, [inProgress, deadline, finish]);

  // Moving between questions on a phone: focus the new one, so it is read out.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const question = document.getElementById(`${baseId}-q${String(index)}`);
    question?.focus();
    question?.scrollIntoView({ block: "start" });
  }, [index, baseId]);

  const answer = (questionId: string, response: Response) => {
    edited.current.add(questionId);
    setRefused(null);
    setAnswers((a) => ({ ...a, [questionId]: response }));
    setLocal({ ...localRef.current, [questionId]: response });
    scheduleBatch();
  };
  const go = (next: number) => {
    moved.current = true;
    setIndex(next);
  };

  const over = !inProgress;
  const count = initial.questions.length;
  const waiting = waitingCount(queued.items, local);
  const status = handingIn
    ? "Handing in your answers…"
    : waiting > 0
      ? online
        ? "Saving…"
        : "Offline: your answers are kept and will be sent when you reconnect."
      : everSaved
        ? "Answers saved"
        : "";
  return (
    <div className="space-y-4">
      {inProgress && !online ? <OfflineBanner /> : null}
      <PageHeader title={title} />
      {refused ? (
        <Banner tone="danger" title="Some answers weren't saved">
          {refused.title}. {refused.body}
        </Banner>
      ) : null}
      {inProgress ? (
        <div className="sticky top-0 z-sticky flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-body-sm text-ink-muted" aria-live="polite">
              {status}
            </p>
            {handingIn ? null : <QueuedPill count={waiting} noun={["answer", "answers"]} />}
          </div>
          {left !== null ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-pill px-3 py-1",
                left < WARNING_MS ? "bg-warning-soft text-warning" : "bg-surface-sunken text-ink",
              )}
            >
              <Icon name="clock" size={16} />
              {left < WARNING_MS ? <span className="sr-only">Under 2 minutes left</span> : null}
              <span role="timer" aria-label="Time left" className="font-mono text-code">
                {clock(left)}
              </span>
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-subhead">
          {initial.score === null
            ? "Submitted. Some answers are waiting for marking."
            : `Score: ${initial.score} / ${initial.maxScore}`}
        </p>
      )}
      {inProgress && count > 1 ? (
        <p className="text-meta text-ink-muted lg:hidden">
          Question {index + 1} of {count}
        </p>
      ) : null}
      <ol className="space-y-4">
        {initial.questions.map((q, i) => {
          const value = answers[q.questionId] ?? null;
          const chosen = value !== null && "optionIds" in value ? value.optionIds : [];
          const text = value !== null && "text" in value ? value.text : "";
          return (
            <li
              key={q.questionId}
              id={`${baseId}-q${String(i)}`}
              tabIndex={-1}
              className={cn(
                cardClass(),
                "space-y-3 scroll-mt-16",
                inProgress && i !== index && "hidden lg:block",
              )}
              aria-label={`Question ${String(i + 1)}`}
            >
              <div className="flex justify-between gap-3">
                <div
                  className="min-w-0 text-subhead"
                  // Rendered from Markdown and sanitized on the server.
                  dangerouslySetInnerHTML={{ __html: q.promptHtml }}
                />
                <span className="shrink-0 text-meta text-ink-muted">
                  {over && q.pointsAwarded !== null ? `${q.pointsAwarded} / ` : ""}
                  {q.points}
                </span>
              </div>
              {q.options.length > 0 ? (
                <fieldset disabled={over}>
                  <legend className="sr-only">Your answer</legend>
                  {q.options.map((o) => {
                    const multi = q.qtype === "MCQ_MULTI";
                    const right = q.correctOptionIds?.includes(o.id) === true;
                    const Choice = multi ? Checkbox : Radio;
                    return (
                      <Choice
                        key={o.id}
                        name={q.questionId}
                        checked={chosen.includes(o.id)}
                        onChange={(e) => {
                          const next = multi
                            ? e.target.checked
                              ? [...chosen, o.id]
                              : chosen.filter((c) => c !== o.id)
                            : [o.id];
                          answer(q.questionId, { optionIds: next });
                        }}
                        label={
                          <span className={right ? "font-semibold text-success" : undefined}>
                            {o.text}
                            {right ? " ✓" : ""}
                          </span>
                        }
                      />
                    );
                  })}
                </fieldset>
              ) : q.qtype === "ESSAY" ? (
                <TextField
                  multiline
                  label="Your answer"
                  rows={6}
                  value={text}
                  readOnly={over}
                  onChange={(e) => {
                    answer(q.questionId, { text: e.target.value });
                  }}
                />
              ) : (
                <TextField
                  label="Your answer"
                  value={text}
                  readOnly={over}
                  onChange={(e) => {
                    answer(q.questionId, { text: e.target.value });
                  }}
                />
              )}
              {q.acceptedAnswers !== null ? (
                <p className="text-body-sm text-success">
                  Accepted: {q.acceptedAnswers.join(", ")}
                </p>
              ) : null}
              {q.explanationHtml !== null ? (
                <div
                  className="text-body-sm text-ink-muted"
                  // Rendered from Markdown and sanitized on the server.
                  dangerouslySetInnerHTML={{ __html: q.explanationHtml }}
                />
              ) : null}
              {q.graderComment !== null ? (
                <p className="text-body-sm text-ink-muted">Comment: {q.graderComment}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {inProgress && count > 1 ? (
        <div className="flex gap-3 lg:hidden">
          {index > 0 ? (
            <Button
              variant="secondary"
              icon="chevronLeft"
              onClick={() => {
                go(index - 1);
              }}
            >
              Previous question
            </Button>
          ) : null}
          {index < count - 1 ? (
            <Button
              variant="secondary"
              onClick={() => {
                go(index + 1);
              }}
            >
              Next question
              <Icon name="chevronRight" size={20} />
            </Button>
          ) : null}
        </div>
      ) : null}
      {inProgress ? (
        <Button variant="primary" block loading={handingIn} onClick={() => void finish()}>
          Submit
        </Button>
      ) : null}
    </div>
  );
}

/** A quiz's finished attempts, and marking essay answers (TRD §14.2). */
export function QuizGradingPage() {
  const { quizId } = useParams({ strict: false });
  const id = quizId ?? "";
  const [open, setOpen] = useState<string | null>(null);
  const quiz = useQuery({
    queryKey: ["quiz", id],
    queryFn: ({ signal }) =>
      api<typeof assessment.getQuiz>("GET", "/quizzes/:id", { params: { id }, signal }),
  });
  const list = useQuery({
    queryKey: ["quiz", id, "attempts"],
    queryFn: ({ signal }) =>
      api<typeof assessment.listQuizAttempts>("GET", "/quizzes/:id/attempts", {
        params: { id },
        signal,
      }),
  });
  useDetailBar(
    quiz.data
      ? {
          back: {
            to: "/teach/$offeringId",
            params: { offeringId: quiz.data.courseOfferingId },
            search: { tab: "work" },
            label: "Course",
          },
        }
      : { back: { to: "/teach", label: "Teaching" } },
  );
  if (list.isPending)
    return (
      <SkeletonGroup label="Loading the attempts">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40" />
      </SkeletonGroup>
    );
  if (list.isError)
    return isNotAvailable(list.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="the attempts" onRetry={() => void list.refetch()} />
    );
  return (
    <div className="space-y-5">
      <PageHeader title="Quiz attempts" meta={quiz.data?.title} />
      <OnlineGrants quizId={id} />
      {list.data.items.length === 0 ? (
        <EmptyState icon="check" title="No attempts yet">
          Finished attempts show here, those with essays to mark first.
        </EmptyState>
      ) : (
        <Card list role="list">
          {list.data.items.map((a) => (
            <div
              key={a.attemptId}
              role="listitem"
              className="space-y-3 px-4 py-3"
              aria-label={`${a.studentName}, attempt ${String(a.attemptNo)}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-subhead">
                    {a.studentName} · attempt {a.attemptNo}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
                    Score {a.score ?? "—"}
                    {a.essaysToMark > 0 ? (
                      <Badge tone="warning">{`${String(a.essaysToMark)} to mark`}</Badge>
                    ) : null}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-expanded={open === a.attemptId}
                  onClick={() => {
                    setOpen(open === a.attemptId ? null : a.attemptId);
                  }}
                >
                  {open === a.attemptId ? "Close" : "Open"}
                </Button>
              </div>
              {open === a.attemptId ? <MarkAttempt attemptId={a.attemptId} quizId={id} /> : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function MarkAttempt({ attemptId, quizId }: { attemptId: string; quizId: string }) {
  const queryClient = useQueryClient();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const attempt = useQuery({
    queryKey: ["quiz-attempt", attemptId],
    queryFn: ({ signal }) =>
      api<typeof assessment.getQuizAttempt>("GET", "/quiz-attempts/:id", {
        params: { id: attemptId },
        signal,
      }),
  });
  if (attempt.isPending)
    return (
      <SkeletonGroup label="Loading the attempt">
        <Skeleton className="h-24" />
      </SkeletonGroup>
    );
  if (attempt.isError)
    return <LoadFailed what="this attempt" onRetry={() => void attempt.refetch()} />;
  return (
    <div className="space-y-4">
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {attempt.data.questions.map((q) => (
        <div key={q.questionId} className="space-y-2 border-t border-line pt-3">
          <div
            className="text-body"
            // Rendered from Markdown and sanitized on the server.
            dangerouslySetInnerHTML={{ __html: q.promptHtml }}
          />
          <p className="rounded-sm bg-surface-sunken p-3 text-body whitespace-pre-wrap">
            {q.response === null
              ? "(no answer)"
              : "text" in q.response
                ? q.response.text
                : q.options
                    .filter((o) => (q.response as { optionIds: string[] }).optionIds.includes(o.id))
                    .map((o) => o.text)
                    .join(", ")}
          </p>
          {q.qtype === "ESSAY" ? (
            <form
              key={q.pointsAwarded ?? "unmarked"}
              aria-label="Mark this answer"
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void run(async () => {
                  const comment = formText(data, "comment").trim();
                  await api<typeof assessment.markQuizResponse>(
                    "PUT",
                    "/quiz-attempts/:id/responses/:questionId",
                    {
                      params: { id: attemptId, questionId: q.questionId },
                      body: {
                        points: formText(data, "points").trim(),
                        comment: comment === "" ? null : comment,
                      },
                    },
                  );
                  await queryClient.invalidateQueries({ queryKey: ["quiz-attempt", attemptId] });
                  await queryClient.invalidateQueries({ queryKey: ["quiz", quizId, "attempts"] });
                });
              }}
            >
              <div className="grid gap-3 md:grid-cols-3">
                <TextField
                  name="points"
                  label={`Points (of ${q.points})`}
                  inputMode="decimal"
                  required
                  defaultValue={q.pointsAwarded ?? ""}
                  error={fieldErrors.points}
                />
                <div className="md:col-span-2">
                  <TextField
                    name="comment"
                    label="Comment"
                    optional
                    defaultValue={q.graderComment ?? ""}
                  />
                </div>
              </div>
              <Button type="submit" variant="secondary" size="sm" loading={busy}>
                Save mark
              </Button>
            </form>
          ) : (
            <p className="flex items-center gap-2 text-body-sm text-ink-muted">
              <Badge tone={q.isCorrect === true ? "success" : "danger"}>
                {q.isCorrect === true ? "Right" : "Wrong"}
              </Badge>
              {q.pointsAwarded ?? "0.00"} / {q.points}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * For an online exam: the On-campus students the Lecturer lets sit it online (C-34). Everyone
 * else on the course follows their Study Mode.
 */
function OnlineGrants({ quizId }: { quizId: string }) {
  const queryClient = useQueryClient();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [formKey, setFormKey] = useState(0);
  const [withdrawing, setWithdrawing] = useState<{ studentId: string; name: string } | null>(null);
  const quiz = useQuery({
    queryKey: ["quiz", quizId],
    queryFn: ({ signal }) =>
      api<typeof assessment.getQuiz>("GET", "/quizzes/:id", { params: { id: quizId }, signal }),
  });
  const exam = quiz.data?.eligibleStudyMode === "ONLINE";
  const offeringId = quiz.data?.courseOfferingId ?? "";
  const grantsKey = ["quiz", quizId, "online-grants"];
  const grants = useQuery({
    queryKey: grantsKey,
    enabled: exam,
    queryFn: ({ signal }) =>
      api<typeof assessment.listOnlineGrants>("GET", "/quizzes/:id/online-grants", {
        params: { id: quizId },
        signal,
      }),
  });
  const book = useQuery({
    queryKey: ["gradebook", offeringId],
    enabled: exam,
    queryFn: ({ signal }) =>
      api<typeof assessment.getGradebook>("GET", "/course-offerings/:id/gradebook", {
        params: { id: offeringId },
        signal,
      }),
  });
  if (!exam) return null;
  const granted = new Set((grants.data?.items ?? []).map((g) => g.studentId));
  const campus = (book.data?.rows ?? []).filter(
    (r) => r.studyMode === "ON_CAMPUS" && !granted.has(r.studentId),
  );
  const items = grants.data?.items ?? [];
  return (
    <section className="space-y-3">
      <h2 className="text-heading">On-campus students sitting online</h2>
      <p className="text-body-sm text-ink-muted">
        Online students take this exam online; On-campus students sit it on paper unless you let
        them in here.
      </p>
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {grants.isError ? (
        <LoadFailed what="who may sit online" onRetry={() => void grants.refetch()} />
      ) : items.length > 0 ? (
        <Card list role="list">
          {items.map((g) => (
            <div
              key={g.studentId}
              role="listitem"
              aria-label={g.studentName}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <span className="text-body">
                {g.studentName} <span className="text-ink-muted">({g.reason})</span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setWithdrawing({ studentId: g.studentId, name: g.studentName });
                }}
              >
                Withdraw
              </Button>
            </div>
          ))}
        </Card>
      ) : null}
      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(next) => {
          if (!next) setWithdrawing(null);
        }}
        title={`Withdraw ${withdrawing?.name ?? ""}'s online sitting?`}
        confirmLabel="Withdraw"
        tone="danger"
        onConfirm={async () => {
          if (withdrawing === null) return;
          await api<typeof assessment.revokeOnline>(
            "DELETE",
            "/quizzes/:id/online-grants/:studentId",
            { params: { id: quizId, studentId: withdrawing.studentId } },
          );
          await queryClient.invalidateQueries({ queryKey: grantsKey });
          setWithdrawing(null);
        }}
      >
        They will sit this exam on paper. An attempt they have already started carries on.
      </ConfirmDialog>
      {campus.length > 0 ? (
        <form
          key={formKey}
          aria-label="Let a student sit online"
          className={cn(cardClass(), "space-y-4")}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void run(async () => {
              await api<typeof assessment.grantOnline>(
                "PUT",
                "/quizzes/:id/online-grants/:studentId",
                {
                  params: { id: quizId, studentId: formText(data, "studentId") },
                  body: { reason: formText(data, "reason") },
                },
              );
              await queryClient.invalidateQueries({ queryKey: grantsKey });
              setFormKey((k) => k + 1);
            });
          }}
        >
          <Select name="studentId" label="Student">
            {campus.map((r) => (
              <option key={r.studentId} value={r.studentId}>
                {r.studentName} ({r.matricNumber})
              </option>
            ))}
          </Select>
          <TextField
            name="reason"
            label="Reason"
            required
            maxLength={500}
            error={fieldErrors.reason}
          />
          <Button type="submit" variant="primary" loading={busy}>
            Let them sit online
          </Button>
        </form>
      ) : null}
    </section>
  );
}
