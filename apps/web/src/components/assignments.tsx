import type { assessment, Assignment } from "@glim/contracts";
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
import { Checkbox } from "./ui/choice";
import { Sheet } from "./ui/dialog";
import { EmptyState } from "./ui/empty-state";
import { TextField } from "./ui/field";
import { Skeleton, SkeletonGroup } from "./ui/skeleton";
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
  return (
    <div className="space-y-4">
      {manage ? <NewAssignment offeringId={offeringId} /> : null}
      {list.isPending ? (
        <SkeletonGroup label="Loading assignments">
          <Skeleton className="h-16" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="the assignments" onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon="file" title="No assignments yet" headingLevel={3}>
          {manage
            ? "Set one with the button above. Students see it once you publish it."
            : "Assignments for this course appear here when your Lecturer sets them."}
        </EmptyState>
      ) : (
        <Card list role="list">
          {list.data.items.map((a) => (
            <AssignmentItem key={a.id} assignment={a} manage={manage} offeringId={offeringId} />
          ))}
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Assignment["status"] }) {
  if (status === "DRAFT") return <Badge status="draft" />;
  if (status === "CLOSED") return <Badge tone="neutral">Closed</Badge>;
  return <Badge tone="success">Published</Badge>;
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
  const { busy, problem, run } = useSubmit();
  return (
    <div role="listitem" aria-label={a.title} className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to="/assignments/$assignmentId"
            params={{ assignmentId: a.id }}
            className="text-subhead text-ink underline-offset-2 hover:underline"
          >
            {a.title}
          </Link>
          <p className="text-meta text-ink-muted">
            Due <Time value={a.dueAt} /> · {a.maxScore} marks · {a.weight}%
          </p>
        </div>
        {manage ? <StatusBadge status={a.status} /> : null}
        {manage ? (
          a.status === "DRAFT" ? (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
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
            </Button>
          ) : (
            <Link
              to="/teach/assignments/$assignmentId/grade"
              params={{ assignmentId: a.id }}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Grade submissions
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

/** A local date and time from a datetime-local field, as an instant. */
const instant = (value: string) => new Date(value).toISOString();

/** "New assignment": a primary button opening a Sheet with the form; it starts as a draft. */
function NewAssignment({ offeringId }: { offeringId: string }) {
  const queryClient = useQueryClient();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [open, setOpen] = useState(false);
  const [allowLate, setAllowLate] = useState(false);
  const formId = useId();
  return (
    <>
      <Button
        variant="primary"
        icon="file"
        onClick={() => {
          setAllowLate(false);
          setOpen(true);
        }}
      >
        New assignment
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="New assignment"
        description="It's saved as a draft; students see it once you publish it."
        footer={
          <Button type="submit" form={formId} variant="primary" block loading={busy}>
            Create assignment
          </Button>
        }
      >
        <form
          id={formId}
          className="space-y-4"
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
                      ...(allowLate && penalty !== ""
                        ? { penaltyPercentPerDay: Number(penalty) }
                        : {}),
                    },
                    submissionTypes: types.length === 0 ? ["FILE", "TEXT"] : types,
                    maxScore: formText(data, "maxScore"),
                    weight: formText(data, "weight"),
                  },
                  headers: { "idempotency-key": crypto.randomUUID() },
                },
              );
              await queryClient.invalidateQueries({ queryKey: assignmentsKey(offeringId) });
              setOpen(false);
            });
          }}
        >
          {problem ? (
            <Banner tone="danger" title={problem.title}>
              {problem.body}
            </Banner>
          ) : null}
          <TextField name="title" label="Title" required error={fieldErrors.title} />
          <TextField
            name="instructionsMd"
            label="Instructions (Markdown)"
            multiline
            rows={4}
            required
            error={fieldErrors.instructionsMd}
          />
          <TextField
            name="dueAt"
            type="datetime-local"
            label="Due (your time)"
            required
            error={fieldErrors.dueAt}
          />
          <TextField
            name="cutoffAt"
            type="datetime-local"
            label="Cutoff: no submissions after"
            optional
            error={fieldErrors.cutoffAt}
          />
          <TextField
            name="maxAttempts"
            type="number"
            min={1}
            max={10}
            defaultValue={1}
            label="Attempts allowed"
            error={fieldErrors.maxAttempts}
          />
          <Checkbox
            label="Accept late work"
            checked={allowLate}
            onChange={(e) => {
              setAllowLate(e.target.checked);
            }}
          />
          {allowLate ? (
            <TextField
              name="penalty"
              type="number"
              min={0}
              max={100}
              label="Suggested penalty per day late (%)"
            />
          ) : null}
          <fieldset>
            <legend className="text-label text-ink">Students submit</legend>
            <div className="flex flex-wrap gap-x-5">
              <Checkbox name="type-FILE" label="Files" defaultChecked />
              <Checkbox name="type-TEXT" label="Text" defaultChecked />
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              name="maxScore"
              inputMode="decimal"
              label="Marks"
              required
              error={fieldErrors.maxScore}
            />
            <TextField
              name="weight"
              inputMode="decimal"
              label="Weight (%)"
              required
              error={fieldErrors.weight}
            />
          </div>
        </form>
      </Sheet>
    </>
  );
}
