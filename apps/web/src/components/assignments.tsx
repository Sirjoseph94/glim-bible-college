import type { assessment, Assignment } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { api } from "../api/client";
import { Alert, Field, formText } from "./form";
import { Time } from "./time";
import { useSubmit } from "./use-submit";

export const assignmentsKey = (offeringId: string) => ["assignments", offeringId];

export function useAssignments(offeringId: string) {
  return useQuery({
    queryKey: assignmentsKey(offeringId),
    queryFn: ({ signal }) =>
      api<typeof assessment.listAssignments>("GET", "/course-offerings/:id/assignments", {
        params: { id: offeringId },
        signal,
      }),
  });
}

/** A course's assignments (TRD §14.2). Staff who set work also create and publish them here. */
export function CourseAssignments({ offeringId, manage }: { offeringId: string; manage: boolean }) {
  const list = useAssignments(offeringId);
  const items = list.data?.items ?? [];
  return (
    <div className="space-y-3 text-sm">
      {list.isSuccess && items.length === 0 ? (
        <p className="text-slate-600">No assignments yet.</p>
      ) : null}
      <ul className="space-y-2">
        {items.map((a) => (
          <AssignmentItem key={a.id} assignment={a} manage={manage} offeringId={offeringId} />
        ))}
      </ul>
      {manage ? <NewAssignment offeringId={offeringId} /> : null}
    </div>
  );
}

function AssignmentItem({
  assignment: a,
  manage,
  offeringId,
}: {
  assignment: Assignment;
  manage: boolean;
  offeringId: string;
}) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  return (
    <li className="space-y-1 rounded border border-slate-200 p-2" aria-label={a.title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          to="/assignments/$assignmentId"
          params={{ assignmentId: a.id }}
          className="font-medium text-blue-700 underline"
        >
          {a.title}
        </Link>
        <span className="text-slate-600">
          {a.status === "DRAFT" ? "Draft · " : null}
          {a.maxScore} marks · {a.weight}%
        </span>
      </div>
      <div className="text-slate-600">
        Due <Time value={a.dueAt} />
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {manage ? (
        <div className="flex gap-3">
          {a.status === "DRAFT" ? (
            <button
              type="button"
              disabled={busy}
              className="underline"
              onClick={() =>
                void run(async () => {
                  await api<typeof assessment.publishAssignment>(
                    "POST",
                    "/assignments/:id/publish",
                    {
                      params: { id: a.id },
                      headers: { "idempotency-key": crypto.randomUUID() },
                    },
                  );
                  await queryClient.invalidateQueries({ queryKey: assignmentsKey(offeringId) });
                })
              }
            >
              Publish
            </button>
          ) : (
            <Link
              to="/teach/assignments/$assignmentId/grade"
              params={{ assignmentId: a.id }}
              className="underline"
            >
              Grade submissions
            </Link>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** A local date and time from a datetime-local field, as an instant. */
const instant = (value: string) => new Date(value).toISOString();

function NewAssignment({ offeringId }: { offeringId: string }) {
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  const [formKey, setFormKey] = useState(0);
  const [allowLate, setAllowLate] = useState(false);
  const id = useId();
  return (
    <form
      key={formKey}
      className="space-y-2 rounded border border-dashed border-slate-300 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const cutoff = formText(data, "cutoffAt");
        const penalty = formText(data, "penalty");
        const types = (["FILE", "TEXT"] as const).filter((k) => data.get(`type-${k}`) === "on");
        void run(async () => {
          await api<typeof assessment.createAssignment>(
            "POST",
            "/course-offerings/:id/assignments",
            {
              params: { id: offeringId },
              body: {
                title: formText(data, "title"),
                instructionsMd: formText(data, "instructionsMd"),
                dueAt: instant(formText(data, "dueAt")),
                cutoffAt: cutoff === "" ? null : instant(cutoff),
                maxAttempts: Number(formText(data, "maxAttempts")),
                latePolicy: {
                  allowLate,
                  ...(allowLate && penalty !== "" ? { penaltyPercentPerDay: Number(penalty) } : {}),
                },
                submissionTypes: types.length === 0 ? ["FILE", "TEXT"] : types,
                maxScore: formText(data, "maxScore"),
                weight: formText(data, "weight"),
              },
              headers: { "idempotency-key": crypto.randomUUID() },
            },
          );
          await queryClient.invalidateQueries({ queryKey: assignmentsKey(offeringId) });
          setFormKey((k) => k + 1);
        });
      }}
    >
      <p className="font-medium">New assignment</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field id={`${id}-title`} name="title" label="Title" required error={fieldErrors.title} />
      <label htmlFor={`${id}-instructions`} className="block font-medium text-slate-700">
        Instructions (Markdown)
      </label>
      <textarea
        id={`${id}-instructions`}
        name="instructionsMd"
        required
        rows={4}
        className="block w-full rounded border border-slate-300 px-3 py-2"
      />
      <Field
        id={`${id}-due`}
        name="dueAt"
        type="datetime-local"
        label="Due (your time)"
        required
        error={fieldErrors.dueAt}
      />
      <Field
        id={`${id}-cutoff`}
        name="cutoffAt"
        type="datetime-local"
        label="Cutoff: no submissions after (optional)"
        error={fieldErrors.cutoffAt}
      />
      <Field
        id={`${id}-attempts`}
        name="maxAttempts"
        type="number"
        min={1}
        max={10}
        defaultValue={1}
        label="Attempts allowed"
      />
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={allowLate}
          onChange={(e) => {
            setAllowLate(e.target.checked);
          }}
        />
        Accept late work
      </label>
      {allowLate ? (
        <Field
          id={`${id}-penalty`}
          name="penalty"
          type="number"
          min={0}
          max={100}
          label="Suggested penalty per day late (%)"
        />
      ) : null}
      <fieldset className="flex gap-4">
        <legend className="font-medium text-slate-700">Students submit</legend>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="type-FILE" defaultChecked /> Files
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="type-TEXT" defaultChecked /> Text
        </label>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <Field
          id={`${id}-max`}
          name="maxScore"
          inputMode="decimal"
          label="Marks"
          required
          error={fieldErrors.maxScore}
        />
        <Field
          id={`${id}-weight`}
          name="weight"
          inputMode="decimal"
          label="Weight (%)"
          required
          error={fieldErrors.weight}
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
      >
        Create assignment
      </button>
    </form>
  );
}
