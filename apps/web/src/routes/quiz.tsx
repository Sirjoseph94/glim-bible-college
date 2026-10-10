import type { assessment, QuizAttempt } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { Alert, formText } from "../components/form";
import { Time } from "../components/time";
import { useSubmit } from "../components/use-submit";

type Response = QuizAttempt["questions"][number]["response"];
type Answers = Record<string, Response>;

const AUTOSAVE_MS = 800;
const RETRY_MS = 3000;

/** Answers not yet stored on the server survive a reload or a dropped connection. */
const pendingKey = (attemptId: string) => `glim:quiz-attempt:${attemptId}`;

function readPending(attemptId: string): Answers {
  try {
    const raw = localStorage.getItem(pendingKey(attemptId));
    return raw === null ? {} : (JSON.parse(raw) as Answers);
  } catch {
    return {};
  }
}

function writePending(attemptId: string, pending: Answers): void {
  try {
    if (Object.keys(pending).length === 0) localStorage.removeItem(pendingKey(attemptId));
    else localStorage.setItem(pendingKey(attemptId), JSON.stringify(pending));
  } catch {
    // Storage may be unavailable (private mode); answers are still sent from memory.
  }
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
  const { busy, error, run } = useSubmit();
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
  if (quiz.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (quiz.isError) return <Alert tone="error">This quiz isn't available to you.</Alert>;
  const z = quiz.data;
  if (attempt !== null)
    return (
      <AttemptView
        initial={attempt}
        title={z.title}
        onDone={(finished) => {
          setAttempt(finished);
          void queryClient.invalidateQueries({ queryKey: ["quiz", id, "mine"] });
        }}
      />
    );
  const running = mine.data?.attempts.find((a) => a.status === "IN_PROGRESS");
  return (
    <div className="space-y-4">
      <h1 className="text-title">{z.title}</h1>
      <p className="text-sm text-slate-600">
        {z.questionCount} questions · {z.maxScore} marks
        {z.timeLimitMinutes === null ? "" : ` · ${String(z.timeLimitMinutes)} minutes`} ·{" "}
        {z.maxAttempts === 1 ? "1 attempt" : `${String(z.maxAttempts)} attempts`}
        {z.closesAt === null ? null : (
          <>
            {" "}
            · closes <Time value={z.closesAt} />
          </>
        )}
      </p>
      {z.instructionsHtml === null ? null : (
        <div
          className="rounded border border-slate-200 bg-white p-3 text-sm"
          // Rendered from Markdown and sanitized on the server.
          dangerouslySetInnerHTML={{ __html: z.instructionsHtml }}
        />
      )}
      {(mine.data?.attempts ?? []).filter((a) => a.status !== "IN_PROGRESS").length > 0 ? (
        <ul className="space-y-1 text-sm">
          {mine.data?.attempts
            .filter((a) => a.status !== "IN_PROGRESS")
            .map((a) => (
              <li key={a.id}>
                Attempt {a.attemptNo}:{" "}
                {a.score === null ? "waiting for marking" : `${a.score} / ${z.maxScore}`}
                <button
                  type="button"
                  className="ml-2 underline"
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
                </button>
              </li>
            ))}
        </ul>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {mine.data?.open === true ? (
        <button
          type="button"
          disabled={busy}
          className="w-full rounded bg-brand px-4 py-2 font-medium text-white disabled:opacity-60"
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
        </button>
      ) : mine.isSuccess ? (
        <p className="text-sm text-slate-600">
          {!mine.data.eligible
            ? "You sit this exam on paper in the Room. Ask your Lecturer if you need to take it online."
            : mine.data.attemptsLeft === 0
              ? "You've used all your attempts."
              : "This quiz isn't open now."}
        </p>
      ) : null}
    </div>
  );
}

/**
 * An attempt in progress or finished. Answers save ~1 s after each change; if the connection
 * drops they wait (in memory and local storage) and are sent when it's back. At the deadline the
 * page sends what it has and submits; the server accepts answers for 30 s after it.
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
  const inProgress = initial.status === "IN_PROGRESS";
  const [answers, setAnswers] = useState<Answers>(() => {
    const saved: Answers = {};
    for (const q of initial.questions) saved[q.questionId] = q.response;
    return { ...saved, ...readPending(attemptId) };
  });
  const pending = useRef<Answers>(readPending(attemptId));
  const seq = useRef(initial.lastSeq);
  const sending = useRef(false);
  const finishing = useRef(false);
  const [status, setStatus] = useState<"saved" | "saving" | "offline" | "finishing" | null>(
    Object.keys(pending.current).length > 0 ? "offline" : null,
  );
  // The server's clock minus ours, so a phone with the wrong time still counts down correctly.
  const skew = useRef(new Date(initial.serverNow).getTime() - Date.now());
  const deadline = initial.deadlineAt === null ? null : new Date(initial.deadlineAt).getTime();
  const [left, setLeft] = useState(deadline === null ? null : deadline - Date.now() - skew.current);

  /** Sends answers not yet stored; true when nothing is left to send. */
  const flush = useCallback(async (): Promise<boolean> => {
    const batch = { ...pending.current };
    if (Object.keys(batch).length === 0) return true;
    if (sending.current) return false;
    sending.current = true;
    // While handing in, the page says so whatever happens to each save.
    const show = (next: "saved" | "saving" | "offline") => {
      if (!finishing.current) setStatus(next);
    };
    show("saving");
    seq.current = Math.max(Date.now(), seq.current + 1);
    try {
      await api<typeof assessment.saveQuizResponses>("PATCH", "/quiz-attempts/:id", {
        params: { id: attemptId },
        body: {
          seq: seq.current,
          responses: Object.entries(batch).map(([questionId, response]) => ({
            questionId,
            response,
          })),
        },
      });
      // Keep only answers changed again while this batch was on its way.
      pending.current = Object.fromEntries(
        Object.entries(pending.current).filter(
          ([questionId, response]) => batch[questionId] !== response,
        ),
      );
      writePending(attemptId, pending.current);
      show(Object.keys(pending.current).length === 0 ? "saved" : "saving");
      return Object.keys(pending.current).length === 0;
    } catch (error) {
      // The attempt has ended on the server: there's nothing more to save.
      if (error instanceof ApiError && error.code === "ATTEMPT_EXPIRED") {
        pending.current = {};
        writePending(attemptId, {});
        return true;
      }
      show("offline");
      return false;
    } finally {
      sending.current = false;
    }
  }, [attemptId]);

  /** Sends what's left, then submits; keeps trying while the connection is down. */
  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    setStatus("finishing");
    for (;;) {
      try {
        await flush();
        const done = await api<typeof assessment.submitQuizAttempt>(
          "POST",
          "/quiz-attempts/:id/submit",
          { params: { id: attemptId }, headers: { "idempotency-key": `submit-${attemptId}` } },
        );
        writePending(attemptId, {});
        onDone(done);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  }, [attemptId, flush, onDone]);

  // Retry unsent answers every few seconds and as soon as the browser is back online.
  useEffect(() => {
    if (!inProgress) return;
    const retry = () => {
      if (!finishing.current) void flush();
    };
    const timer = window.setInterval(retry, RETRY_MS);
    window.addEventListener("online", retry);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", retry);
    };
  }, [inProgress, flush]);

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

  const answer = (questionId: string, response: Response) => {
    setAnswers((a) => ({ ...a, [questionId]: response }));
    pending.current = { ...pending.current, [questionId]: response };
    writePending(attemptId, pending.current);
    setStatus("saving");
    window.setTimeout(() => void flush(), AUTOSAVE_MS);
  };

  const over = !inProgress;
  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-slate-50 py-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {inProgress && left !== null ? (
          <span
            role="timer"
            aria-label="Time left"
            className={`rounded px-2 py-1 font-mono ${left < 60_000 ? "bg-red-100 text-red-800" : "bg-slate-200"}`}
          >
            {clock(left)}
          </span>
        ) : null}
      </div>
      {inProgress ? (
        <p className="text-xs text-slate-500" aria-live="polite">
          {status === "saving"
            ? "Saving…"
            : status === "saved"
              ? "Answers saved"
              : status === "offline"
                ? "Offline: your answers are kept and will be sent when you reconnect."
                : status === "finishing"
                  ? "Handing in your answers…"
                  : null}
        </p>
      ) : (
        <p className="font-medium">
          {initial.score === null
            ? "Submitted. Some answers are waiting for marking."
            : `Score: ${initial.score} / ${initial.maxScore}`}
        </p>
      )}
      <ol className="space-y-4">
        {initial.questions.map((q, i) => {
          const value = answers[q.questionId] ?? null;
          const chosen = value !== null && "optionIds" in value ? value.optionIds : [];
          const text = value !== null && "text" in value ? value.text : "";
          return (
            <li
              key={q.questionId}
              className="space-y-2 rounded border border-slate-200 bg-white p-3 text-sm"
              aria-label={`Question ${String(i + 1)}`}
            >
              <div className="flex justify-between gap-2">
                <div
                  className="font-medium"
                  // Rendered from Markdown and sanitized on the server.
                  dangerouslySetInnerHTML={{ __html: q.promptHtml }}
                />
                <span className="shrink-0 text-slate-500">
                  {over && q.pointsAwarded !== null ? `${q.pointsAwarded} / ` : ""}
                  {q.points}
                </span>
              </div>
              {q.options.length > 0 ? (
                <fieldset className="space-y-1" disabled={over}>
                  {q.options.map((o) => {
                    const multi = q.qtype === "MCQ_MULTI";
                    const right = q.correctOptionIds?.includes(o.id) === true;
                    return (
                      <label key={o.id} className="flex items-center gap-2">
                        <input
                          type={multi ? "checkbox" : "radio"}
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
                        />
                        <span className={right ? "font-medium text-green-800" : ""}>
                          {o.text}
                          {right ? " ✓" : ""}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : (
                <textarea
                  aria-label="Your answer"
                  rows={q.qtype === "ESSAY" ? 6 : 1}
                  value={text}
                  readOnly={over}
                  onChange={(e) => {
                    answer(q.questionId, { text: e.target.value });
                  }}
                  className="block w-full rounded border border-slate-300 px-3 py-2"
                />
              )}
              {q.acceptedAnswers !== null ? (
                <p className="text-green-800">Accepted: {q.acceptedAnswers.join(", ")}</p>
              ) : null}
              {q.explanationHtml !== null ? (
                <div
                  className="text-slate-700"
                  // Rendered from Markdown and sanitized on the server.
                  dangerouslySetInnerHTML={{ __html: q.explanationHtml }}
                />
              ) : null}
              {q.graderComment !== null ? (
                <p className="text-slate-700">Comment: {q.graderComment}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {inProgress ? (
        <button
          type="button"
          disabled={status === "finishing"}
          className="w-full rounded bg-brand px-4 py-2 font-medium text-white disabled:opacity-60"
          onClick={() => void finish()}
        >
          Submit
        </button>
      ) : null}
    </div>
  );
}

/** A quiz's finished attempts, and marking essay answers (TRD §14.2). */
export function QuizGradingPage() {
  const { quizId } = useParams({ strict: false });
  const id = quizId ?? "";
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["quiz", id, "attempts"],
    queryFn: ({ signal }) =>
      api<typeof assessment.listQuizAttempts>("GET", "/quizzes/:id/attempts", {
        params: { id },
        signal,
      }),
  });
  if (list.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (list.isError) return <Alert tone="error">We couldn't load the attempts.</Alert>;
  return (
    <div className="space-y-4">
      <h1 className="text-title">Quiz attempts</h1>
      <OnlineGrants quizId={id} />
      {list.data.items.length === 0 ? <p className="text-slate-600">No attempts yet.</p> : null}
      <ul className="space-y-2 text-sm">
        {list.data.items.map((a) => (
          <li
            key={a.attemptId}
            className="space-y-2 rounded border border-slate-200 bg-white p-3"
            aria-label={`${a.studentName}, attempt ${String(a.attemptNo)}`}
          >
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">
                {a.studentName} · attempt {a.attemptNo}
              </span>
              <span>
                {a.score ?? "—"}
                {a.essaysToMark > 0 ? ` · ${String(a.essaysToMark)} to mark` : ""}
              </span>
            </div>
            <button
              type="button"
              className="underline"
              onClick={() => {
                setOpen(open === a.attemptId ? null : a.attemptId);
              }}
            >
              {open === a.attemptId ? "Close" : "Open"}
            </button>
            {open === a.attemptId ? <MarkAttempt attemptId={a.attemptId} quizId={id} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MarkAttempt({ attemptId, quizId }: { attemptId: string; quizId: string }) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const attempt = useQuery({
    queryKey: ["quiz-attempt", attemptId],
    queryFn: ({ signal }) =>
      api<typeof assessment.getQuizAttempt>("GET", "/quiz-attempts/:id", {
        params: { id: attemptId },
        signal,
      }),
  });
  if (attempt.data === undefined) return null;
  return (
    <div className="space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {attempt.data.questions.map((q) => (
        <div key={q.questionId} className="space-y-1 border-t border-slate-100 pt-2">
          <div dangerouslySetInnerHTML={{ __html: q.promptHtml }} />
          <p className="whitespace-pre-wrap rounded bg-slate-50 p-2">
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
              className="flex flex-wrap items-end gap-2"
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
              <label>
                <span className="block text-slate-700">Points (of {q.points})</span>
                <input
                  name="points"
                  inputMode="decimal"
                  required
                  defaultValue={q.pointsAwarded ?? ""}
                  className="w-24 rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <label className="min-w-0 flex-1">
                <span className="block text-slate-700">Comment</span>
                <input
                  name="comment"
                  defaultValue={q.graderComment ?? ""}
                  className="w-full rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <button type="submit" disabled={busy} className="underline">
                Save mark
              </button>
            </form>
          ) : (
            <p className="text-slate-500">
              {q.isCorrect === true ? "Right" : "Wrong"} · {q.pointsAwarded ?? "0.00"} / {q.points}
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
  const { busy, error, fieldErrors, run } = useSubmit();
  const [formKey, setFormKey] = useState(0);
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
  return (
    <section className="space-y-2 rounded border border-slate-200 bg-white p-3 text-sm">
      <h3 className="font-medium">On-campus students sitting online</h3>
      <p className="text-slate-600">
        Online students take this exam online; On-campus students sit it on paper unless you let
        them in here.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="space-y-1">
        {(grants.data?.items ?? []).map((g) => (
          <li key={g.studentId} className="flex flex-wrap items-baseline justify-between gap-2">
            <span>
              {g.studentName} <span className="text-slate-500">({g.reason})</span>
            </span>
            <button
              type="button"
              disabled={busy}
              className="text-brand underline"
              onClick={() =>
                void run(async () => {
                  await api<typeof assessment.revokeOnline>(
                    "DELETE",
                    "/quizzes/:id/online-grants/:studentId",
                    { params: { id: quizId, studentId: g.studentId } },
                  );
                  await queryClient.invalidateQueries({ queryKey: grantsKey });
                })
              }
            >
              Withdraw
            </button>
          </li>
        ))}
      </ul>
      {campus.length > 0 ? (
        <form
          key={formKey}
          aria-label="Let a student sit online"
          className="space-y-2"
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
          <label className="block">
            <span className="block text-slate-700">Student</span>
            <select name="studentId" className="w-full rounded border border-slate-300 px-2 py-2">
              {campus.map((r) => (
                <option key={r.studentId} value={r.studentId}>
                  {r.studentName} ({r.matricNumber})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-slate-700">Reason</span>
            <input
              name="reason"
              required
              maxLength={500}
              className="block w-full rounded border border-slate-300 px-3 py-2"
              aria-invalid={fieldErrors.reason === undefined ? undefined : true}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
          >
            Let them sit online
          </button>
        </form>
      ) : null}
    </section>
  );
}
