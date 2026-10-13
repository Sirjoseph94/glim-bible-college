import type { assessment, Question, Quiz } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { api } from "../api/client";
import { LoadFailed } from "./app/page-states";
import { formText } from "./form";
import { Time } from "./time";
import { Badge } from "./ui/badge";
import { Banner } from "./ui/banner";
import { Button, buttonClass } from "./ui/button";
import { Card } from "./ui/card";
import { Checkbox, Radio } from "./ui/choice";
import { Sheet } from "./ui/dialog";
import { Disclosure } from "./ui/disclosure";
import { EmptyState } from "./ui/empty-state";
import { Select, TextField } from "./ui/field";
import { Skeleton, SkeletonGroup } from "./ui/skeleton";
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
    <div className="space-y-4">
      {manage ? <NewQuiz offeringId={offeringId} /> : null}
      {list.isPending ? (
        <SkeletonGroup label="Loading the quizzes">
          <Skeleton className="h-16" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="the quizzes" onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="check" title="No quizzes yet" headingLevel={3}>
          {manage
            ? "Add questions to the question bank, then build a quiz from them."
            : "Quizzes and online exams show here when your Lecturer publishes them."}
        </EmptyState>
      ) : (
        <Card list role="list">
          {items.map((z) => (
            <QuizItem key={z.id} quiz={z} manage={manage} offeringId={offeringId} />
          ))}
        </Card>
      )}
      {manage ? <QuestionBank offeringId={offeringId} /> : null}
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
  const { busy, problem, run } = useSubmit();
  return (
    <div role="listitem" aria-label={z.title} className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link
            to="/quizzes/$quizId"
            params={{ quizId: z.id }}
            className="text-subhead text-brand underline"
          >
            {z.title}
          </Link>
          <p className="flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
            {z.status === "DRAFT" ? <Badge status="draft" /> : null}
            <span>
              {z.kind === "EXAM" ? "Online exam · " : null}
              {z.questionCount} questions · {z.maxScore} marks
              {z.timeLimitMinutes === null ? "" : ` · ${String(z.timeLimitMinutes)} min`}
            </span>
          </p>
          {z.closesAt !== null ? (
            <p className="text-body-sm text-ink-muted">
              Closes <Time value={z.closesAt} />
            </p>
          ) : null}
        </div>
        {manage ? (
          z.status === "DRAFT" ? (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
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
            </Button>
          ) : (
            <Link
              to="/teach/quizzes/$quizId/grade"
              params={{ quizId: z.id }}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Attempts and essays
            </Link>
          )
        ) : null}
      </div>
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
    </div>
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

const OPTION_SLOTS = [0, 1, 2, 3, 4];

/** The course's question bank: every offering of the course shares it. */
function QuestionBank({ offeringId }: { offeringId: string }) {
  const queryClient = useQueryClient();
  const questions = useQuestions(offeringId);
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [qtype, setQtype] = useState<Question["qtype"]>("MCQ_SINGLE");
  const [adding, setAdding] = useState(false);
  const formId = useId();
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
    return OPTION_SLOTS.map((i) => ({
      id: String.fromCharCode(97 + i),
      text: formText(data, `option-${String(i)}`).trim(),
      correct: data.get(`correct-${String(i)}`) === "on",
    })).filter((o) => o.text !== "");
  };

  return (
    <Card>
      <Disclosure summary={`Question bank (${String(items.length)})`}>
        <div className="space-y-3">
          {questions.isError ? (
            <LoadFailed what="the question bank" onRetry={() => void questions.refetch()} />
          ) : items.length === 0 ? (
            <p className="text-body-sm text-ink-muted">
              No questions yet. Every offering of this course shares the bank.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((question) => (
                <li key={question.id} className="py-2 text-body-sm">
                  <span className="text-ink-muted">{QTYPE_LABEL[question.qtype]}:</span>{" "}
                  {question.promptMd} ({question.defaultPoints})
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              setAdding(true);
            }}
          >
            Add a question
          </Button>
        </div>
      </Disclosure>
      <Sheet
        open={adding}
        onOpenChange={setAdding}
        title="Add a question"
        footer={
          <Button type="submit" form={formId} variant="primary" block loading={busy}>
            Add question
          </Button>
        }
      >
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const points = formText(data, "points").trim();
            void run(async () => {
              await api<typeof assessment.createQuestion>(
                "POST",
                "/course-offerings/:id/questions",
                {
                  params: { id: offeringId },
                  body: {
                    qtype,
                    promptMd: formText(data, "promptMd"),
                    options: options(data),
                    ...(points === "" ? {} : { defaultPoints: points }),
                  },
                  headers: { "idempotency-key": crypto.randomUUID() },
                },
              );
              await queryClient.invalidateQueries({ queryKey: questionsKey(offeringId) });
              setAdding(false);
            });
          }}
        >
          {problem ? (
            <Banner tone="danger" title={problem.title}>
              {problem.body}
            </Banner>
          ) : null}
          <Select
            label="Type"
            value={qtype}
            onChange={(e) => {
              setQtype(e.target.value as Question["qtype"]);
            }}
          >
            {Object.entries(QTYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <TextField
            multiline
            name="promptMd"
            label="Question"
            required
            rows={2}
            error={fieldErrors.promptMd}
          />
          {qtype === "MCQ_SINGLE" || qtype === "MCQ_MULTI" ? (
            <fieldset className="space-y-3">
              <legend className="text-label text-ink">Options (tick the right answers)</legend>
              {OPTION_SLOTS.map((i) => (
                <div key={i} className="space-y-1">
                  <TextField
                    name={`option-${String(i)}`}
                    label={`Option ${String(i + 1)}`}
                    optional={i > 1}
                  />
                  <Checkbox
                    name={`correct-${String(i)}`}
                    label={
                      <>
                        Right answer<span className="sr-only"> (option {i + 1})</span>
                      </>
                    }
                  />
                </div>
              ))}
            </fieldset>
          ) : qtype === "TRUE_FALSE" ? (
            <fieldset>
              <legend className="text-label text-ink">The answer is</legend>
              <Radio name="truth" value="true" defaultChecked label="True" />
              <Radio name="truth" value="false" label="False" />
            </fieldset>
          ) : qtype === "SHORT_TEXT" ? (
            <TextField
              multiline
              name="accepted"
              label="Accepted answers (one per line)"
              required
              rows={2}
            />
          ) : null}
          <TextField
            name="points"
            inputMode="decimal"
            label="Points"
            optional
            hint="1 if left empty."
            error={fieldErrors.defaultPoints}
          />
        </form>
      </Sheet>
    </Card>
  );
}

const instant = (value: string) => new Date(value).toISOString();

/** "New quiz": builds a quiz, or an exam's online part, from the question bank in a Sheet. */
function NewQuiz({ offeringId }: { offeringId: string }) {
  const queryClient = useQueryClient();
  const questions = useQuestions(offeringId);
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [open, setOpen] = useState(false);
  const [noQuestions, setNoQuestions] = useState(false);
  // "" for a quiz, or the EXAM column this is the online part of.
  const [examId, setExamId] = useState("");
  const formId = useId();
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
    <>
      <Button
        variant="primary"
        onClick={() => {
          setExamId("");
          setNoQuestions(false);
          setOpen(true);
        }}
      >
        New quiz
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="New quiz or online exam"
        footer={
          <Button type="submit" form={formId} variant="primary" block loading={busy}>
            {examId === "" ? "Create quiz" : "Create online exam"}
          </Button>
        }
      >
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const limit = formText(data, "timeLimit").trim();
            const opens = formText(data, "opensAt");
            const closes = formText(data, "closesAt");
            const chosen = items.filter((q) => data.get(`q-${q.id}`) === "on");
            setNoQuestions(chosen.length === 0);
            if (chosen.length === 0) return;
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
                await api<typeof assessment.createOnlineExam>(
                  "POST",
                  "/assessments/:id/online-exam",
                  {
                    params: { id: examId },
                    body: settings,
                    headers: { "idempotency-key": crypto.randomUUID() },
                  },
                );
              await queryClient.invalidateQueries({ queryKey: quizzesKey(offeringId) });
              await queryClient.invalidateQueries({ queryKey: ["gradebook", offeringId] });
              setOpen(false);
            });
          }}
        >
          {problem ? (
            <Banner tone="danger" title={problem.title}>
              {problem.body}
            </Banner>
          ) : null}
          {exams.length > 0 ? (
            <Select
              name="for"
              label="For"
              value={examId}
              onChange={(e) => {
                setExamId(e.target.value);
              }}
            >
              <option value="">A quiz</option>
              {exams.map((c) => (
                <option key={c.assessmentId} value={c.assessmentId}>
                  Online part of {c.title} (for Online students)
                </option>
              ))}
            </Select>
          ) : null}
          {examId === "" ? (
            <TextField name="title" label="Quiz title" required error={fieldErrors.title} />
          ) : (
            <p className="text-body-sm text-ink-muted">
              Scores are scaled from the questions' points to the exam's maximum.
            </p>
          )}
          <fieldset aria-describedby={noQuestions ? `${formId}-questions` : undefined}>
            <legend className="text-label text-ink">Questions</legend>
            {items.map((q) => (
              <Checkbox
                key={q.id}
                name={`q-${q.id}`}
                label={
                  <>
                    {q.promptMd} <span className="text-ink-muted">({q.defaultPoints})</span>
                  </>
                }
              />
            ))}
            {noQuestions ? (
              <p id={`${formId}-questions`} className="text-body-sm text-danger">
                Choose at least one question.
              </p>
            ) : null}
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              name="timeLimit"
              type="number"
              min={1}
              max={600}
              label="Time limit (minutes)"
              required={examId !== ""}
              optional={examId === ""}
              error={fieldErrors.timeLimitMinutes}
            />
            <TextField
              name="maxAttempts"
              type="number"
              min={1}
              max={10}
              defaultValue={1}
              label="Attempts"
              error={fieldErrors.maxAttempts}
            />
            {examId === "" ? (
              <TextField
                name="weight"
                inputMode="decimal"
                label="Weight (%)"
                required
                error={fieldErrors.weight}
              />
            ) : null}
            <Select name="scoring" label="Score from attempts">
              <option value="HIGHEST">Highest</option>
              <option value="LAST">Last</option>
              <option value="AVERAGE">Average</option>
            </Select>
          </div>
          <TextField name="opensAt" type="datetime-local" label="Opens" optional />
          <TextField name="closesAt" type="datetime-local" label="Closes" optional />
          <Select name="showAnswers" label="Show answers" defaultValue="AFTER_CLOSE">
            <option value="AFTER_ATTEMPT">After each attempt</option>
            <option value="AFTER_CLOSE">After the quiz closes</option>
            <option value="NEVER">Never</option>
          </Select>
          <Checkbox name="shuffle" label="Shuffle the questions" />
        </form>
      </Sheet>
    </>
  );
}
