import type { assessment, Question, Quiz } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { api } from "../api/client";
import { Alert, Field, formText } from "./form";
import { Time } from "./time";
import { useSubmit } from "./use-submit";

const quizzesKey = (offeringId: string) => ["quizzes", offeringId];
const questionsKey = (offeringId: string) => ["questions", offeringId];

const QTYPE_LABEL: Record<Question["qtype"], string> = {
  MCQ_SINGLE: "Multiple choice (one answer)",
  MCQ_MULTI: "Multiple choice (several answers)",
  TRUE_FALSE: "True or false",
  SHORT_TEXT: "Short answer",
  ESSAY: "Essay",
};

/** A course's quizzes (TRD §14.2); its staff also keep the question bank and build quizzes. */
export function CourseQuizzes({ offeringId, manage }: { offeringId: string; manage: boolean }) {
  const list = useQuery({
    queryKey: quizzesKey(offeringId),
    queryFn: ({ signal }) =>
      api<typeof assessment.listQuizzes>("GET", "/course-offerings/:id/quizzes", {
        params: { id: offeringId },
        signal,
      }),
  });
  const items = list.data?.items ?? [];
  return (
    <div className="space-y-3 text-sm">
      {list.isSuccess && items.length === 0 ? (
        <p className="text-slate-600">No quizzes yet.</p>
      ) : null}
      <ul className="space-y-2">
        {items.map((z) => (
          <QuizItem key={z.id} quiz={z} manage={manage} offeringId={offeringId} />
        ))}
      </ul>
      {manage ? (
        <>
          <QuestionBank offeringId={offeringId} />
          <NewQuiz offeringId={offeringId} />
        </>
      ) : null}
    </div>
  );
}

function QuizItem({
  quiz: z,
  manage,
  offeringId,
}: {
  quiz: Quiz;
  manage: boolean;
  offeringId: string;
}) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  return (
    <li className="space-y-1 rounded border border-slate-200 p-2" aria-label={z.title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          to="/quizzes/$quizId"
          params={{ quizId: z.id }}
          className="font-medium text-blue-700 underline"
        >
          {z.title}
        </Link>
        <span className="text-slate-600">
          {z.status === "DRAFT" ? "Draft · " : null}
          {z.kind === "EXAM" ? "Online exam · " : null}
          {z.questionCount} questions · {z.maxScore} marks
          {z.timeLimitMinutes === null ? "" : ` · ${String(z.timeLimitMinutes)} min`}
        </span>
      </div>
      {z.closesAt !== null ? (
        <div className="text-slate-600">
          Closes <Time value={z.closesAt} />
        </div>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {manage ? (
        z.status === "DRAFT" ? (
          <button
            type="button"
            disabled={busy}
            className="underline"
            onClick={() =>
              void run(async () => {
                await api<typeof assessment.publishQuiz>("POST", "/quizzes/:id/publish", {
                  params: { id: z.id },
                  headers: { "idempotency-key": crypto.randomUUID() },
                });
                await queryClient.invalidateQueries({ queryKey: quizzesKey(offeringId) });
              })
            }
          >
            Publish
          </button>
        ) : (
          <Link to="/teach/quizzes/$quizId/grade" params={{ quizId: z.id }} className="underline">
            Attempts and essays
          </Link>
        )
      ) : null}
    </li>
  );
}

function useQuestions(offeringId: string) {
  return useQuery({
    queryKey: questionsKey(offeringId),
    queryFn: ({ signal }) =>
      api<typeof assessment.listQuestions>("GET", "/course-offerings/:id/questions", {
        params: { id: offeringId },
        signal,
      }),
  });
}

/** The course's question bank: every offering of the course shares it. */
function QuestionBank({ offeringId }: { offeringId: string }) {
  const queryClient = useQueryClient();
  const questions = useQuestions(offeringId);
  const { busy, error, run } = useSubmit();
  const [qtype, setQtype] = useState<Question["qtype"]>("MCQ_SINGLE");
  const [formKey, setFormKey] = useState(0);
  const id = useId();
  const items = questions.data?.items ?? [];

  const options = (data: FormData) => {
    if (qtype === "ESSAY") return [];
    if (qtype === "TRUE_FALSE") {
      const truth = data.get("truth") === "true";
      return [
        { id: "true", text: "True", correct: truth },
        { id: "false", text: "False", correct: !truth },
      ];
    }
    if (qtype === "SHORT_TEXT")
      return formText(data, "accepted")
        .split("\n")
        .map((t) => t.trim())
        .filter((t) => t !== "")
        .map((text, i) => ({ id: String(i + 1), text, correct: true }));
    return [0, 1, 2, 3, 4]
      .map((i) => ({
        id: String.fromCharCode(97 + i),
        text: formText(data, `option-${String(i)}`).trim(),
        correct: data.get(`correct-${String(i)}`) === "on",
      }))
      .filter((o) => o.text !== "");
  };

  return (
    <details className="rounded border border-slate-200 p-2">
      <summary className="cursor-pointer font-medium">Question bank ({items.length})</summary>
      <ul className="mt-2 space-y-1">
        {items.map((question) => (
          <li key={question.id} className="text-slate-700">
            <span className="text-slate-500">{QTYPE_LABEL[question.qtype]}:</span>{" "}
            {question.promptMd} ({question.defaultPoints})
          </li>
        ))}
      </ul>
      <form
        key={formKey}
        className="mt-2 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const points = formText(data, "points").trim();
          void run(async () => {
            await api<typeof assessment.createQuestion>("POST", "/course-offerings/:id/questions", {
              params: { id: offeringId },
              body: {
                qtype,
                promptMd: formText(data, "promptMd"),
                options: options(data),
                ...(points === "" ? {} : { defaultPoints: points }),
              },
              headers: { "idempotency-key": crypto.randomUUID() },
            });
            await queryClient.invalidateQueries({ queryKey: questionsKey(offeringId) });
            setFormKey((k) => k + 1);
          });
        }}
      >
        <p className="font-medium">Add a question</p>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <label className="block">
          <span className="block text-slate-700">Type</span>
          <select
            value={qtype}
            onChange={(e) => {
              setQtype(e.target.value as Question["qtype"]);
            }}
            className="rounded border border-slate-300 px-2 py-2"
          >
            {Object.entries(QTYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-prompt`} className="block text-slate-700">
          Question
        </label>
        <textarea
          id={`${id}-prompt`}
          name="promptMd"
          required
          rows={2}
          className="block w-full rounded border border-slate-300 px-3 py-2"
        />
        {qtype === "MCQ_SINGLE" || qtype === "MCQ_MULTI" ? (
          <fieldset className="space-y-1">
            <legend className="text-slate-700">Options (tick the right answers)</legend>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  name={`option-${String(i)}`}
                  aria-label={`Option ${String(i + 1)}`}
                  className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
                />
                <label className="flex items-center gap-1">
                  <input type="checkbox" name={`correct-${String(i)}`} />
                  Right answer
                </label>
              </div>
            ))}
          </fieldset>
        ) : qtype === "TRUE_FALSE" ? (
          <fieldset className="flex gap-4">
            <legend className="text-slate-700">The answer is</legend>
            <label className="flex items-center gap-1">
              <input type="radio" name="truth" value="true" defaultChecked /> True
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="truth" value="false" /> False
            </label>
          </fieldset>
        ) : qtype === "SHORT_TEXT" ? (
          <label className="block">
            <span className="block text-slate-700">Accepted answers (one per line)</span>
            <textarea
              name="accepted"
              required
              rows={2}
              className="block w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>
        ) : null}
        <Field id={`${id}-points`} name="points" inputMode="decimal" label="Points (default 1)" />
        <button type="submit" disabled={busy} className="underline">
          Add question
        </button>
      </form>
    </details>
  );
}

const instant = (value: string) => new Date(value).toISOString();

function NewQuiz({ offeringId }: { offeringId: string }) {
  const queryClient = useQueryClient();
  const questions = useQuestions(offeringId);
  const { busy, error, fieldErrors, run } = useSubmit();
  const [formKey, setFormKey] = useState(0);
  // "" for a quiz, or the EXAM column this is the online part of.
  const [examId, setExamId] = useState("");
  const id = useId();
  const book = useQuery({
    queryKey: ["gradebook", offeringId],
    queryFn: ({ signal }) =>
      api<typeof assessment.getGradebook>("GET", "/course-offerings/:id/gradebook", {
        params: { id: offeringId },
        signal,
      }),
  });
  const exams = (book.data?.columns ?? []).filter(
    (c) => c.kind === "EXAM" && c.onlineQuizId === null,
  );
  const items = questions.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <form
      key={formKey}
      className="space-y-2 rounded border border-dashed border-slate-300 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const limit = formText(data, "timeLimit").trim();
        const opens = formText(data, "opensAt");
        const closes = formText(data, "closesAt");
        const chosen = items.filter((q) => data.get(`q-${q.id}`) === "on");
        const settings = {
          timeLimitMinutes: limit === "" ? null : Number(limit),
          maxAttempts: Number(formText(data, "maxAttempts")),
          attemptScoring: formText(data, "scoring") as Quiz["attemptScoring"],
          showAnswers: formText(data, "showAnswers") as Quiz["showAnswers"],
          shuffleQuestions: data.get("shuffle") === "on",
          opensAt: opens === "" ? null : instant(opens),
          closesAt: closes === "" ? null : instant(closes),
          questions: chosen.map((q) => ({ questionId: q.id })),
        };
        void run(async () => {
          if (chosen.length === 0) throw new Error("Choose at least one question.");
          if (examId === "")
            await api<typeof assessment.createQuiz>("POST", "/course-offerings/:id/quizzes", {
              params: { id: offeringId },
              body: {
                ...settings,
                title: formText(data, "title"),
                weight: formText(data, "weight"),
              },
              headers: { "idempotency-key": crypto.randomUUID() },
            });
          else
            await api<typeof assessment.createOnlineExam>("POST", "/assessments/:id/online-exam", {
              params: { id: examId },
              body: settings,
              headers: { "idempotency-key": crypto.randomUUID() },
            });
          await queryClient.invalidateQueries({ queryKey: quizzesKey(offeringId) });
          await queryClient.invalidateQueries({ queryKey: ["gradebook", offeringId] });
          setExamId("");
          setFormKey((k) => k + 1);
        });
      }}
    >
      <p className="font-medium">New quiz or online exam</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {exams.length > 0 ? (
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">For</span>
          <select
            name="for"
            value={examId}
            onChange={(e) => {
              setExamId(e.target.value);
            }}
            className="w-full rounded border border-slate-300 px-2 py-2"
          >
            <option value="">A quiz</option>
            {exams.map((c) => (
              <option key={c.assessmentId} value={c.assessmentId}>
                Online part of {c.title} (for Online students)
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {examId === "" ? (
        <Field
          id={`${id}-title`}
          name="title"
          label="Quiz title"
          required
          error={fieldErrors.title}
        />
      ) : (
        <p className="text-slate-600">
          Scores are scaled from the questions' points to the exam's maximum.
        </p>
      )}
      <fieldset className="space-y-1">
        <legend className="text-slate-700">Questions</legend>
        {items.map((q) => (
          <label key={q.id} className="flex items-start gap-2">
            <input type="checkbox" name={`q-${q.id}`} className="mt-1" />
            <span>
              {q.promptMd} <span className="text-slate-500">({q.defaultPoints})</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <Field
          id={`${id}-limit`}
          name="timeLimit"
          type="number"
          min={1}
          max={600}
          label="Time limit (minutes)"
          required={examId !== ""}
        />
        <Field
          id={`${id}-attempts`}
          name="maxAttempts"
          type="number"
          min={1}
          max={10}
          defaultValue={1}
          label="Attempts"
        />
        {examId === "" ? (
          <Field
            id={`${id}-weight`}
            name="weight"
            inputMode="decimal"
            label="Weight (%)"
            required
            error={fieldErrors.weight}
          />
        ) : null}
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Score from attempts</span>
          <select name="scoring" className="w-full rounded border border-slate-300 px-2 py-2">
            <option value="HIGHEST">Highest</option>
            <option value="LAST">Last</option>
            <option value="AVERAGE">Average</option>
          </select>
        </label>
      </div>
      <Field id={`${id}-opens`} name="opensAt" type="datetime-local" label="Opens (optional)" />
      <Field id={`${id}-closes`} name="closesAt" type="datetime-local" label="Closes (optional)" />
      <label className="block">
        <span className="block text-sm font-medium text-slate-700">Show answers</span>
        <select
          name="showAnswers"
          defaultValue="AFTER_CLOSE"
          className="w-full rounded border border-slate-300 px-2 py-2"
        >
          <option value="AFTER_ATTEMPT">After each attempt</option>
          <option value="AFTER_CLOSE">After the quiz closes</option>
          <option value="NEVER">Never</option>
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="shuffle" /> Shuffle the questions
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
      >
        {examId === "" ? "Create quiz" : "Create online exam"}
      </button>
    </form>
  );
}
