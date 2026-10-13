import type { admissions, calendar, Intake } from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { formText } from "../components/form";
import { CalendarDate } from "../components/time";
import { Badge, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog, Sheet } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Select, TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";

const intakesQuery = queryOptions({
  queryKey: ["intakes"],
  queryFn: ({ signal }) => api<typeof admissions.listIntakes>("GET", "/intakes", { signal }),
});
const sessionsQuery = queryOptions({
  queryKey: ["academic-sessions"],
  queryFn: ({ signal }) =>
    api<typeof calendar.listAcademicSessions>("GET", "/academic-sessions", { signal }),
});

type Transition = typeof admissions.openIntake;
const PATHS = { open: "/intakes/:id/open", close: "/intakes/:id/close" } as const satisfies Record<
  string,
  Transition["path"]
>;

const INTAKE_STATUS: Record<Intake["status"], { tone: Tone; word: string }> = {
  PLANNED: { tone: "info", word: "Planned" },
  OPEN: { tone: "success", word: "Open" },
  CLOSED: { tone: "neutral", word: "Closed" },
};

/** The yearly intake for the Admissions Officer (TRD §10.1). */
export function AdmissionsIntakesPage() {
  const intakes = useQuery(intakesQuery);
  const queryClient = useQueryClient();
  const [planning, setPlanning] = useState(false);
  // The intake and the change waiting for the officer to confirm it.
  const [confirming, setConfirming] = useState<{
    intake: Intake;
    action: keyof typeof PATHS;
  } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["intakes"] });
  // ConfirmDialog shows a failure itself, so the request's error is left to throw.
  const act = async (intake: Intake, action: keyof typeof PATHS) => {
    await api<Transition>("POST", PATHS[action], { params: { id: intake.id } });
    await refresh();
    setConfirming(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Intakes"
        meta="When applications open and close each year."
        actions={
          <Button
            variant="primary"
            icon="calendar"
            onClick={() => {
              setPlanning(true);
            }}
          >
            Plan an intake
          </Button>
        }
      />
      {intakes.isPending ? (
        <SkeletonGroup label="Loading intakes">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </SkeletonGroup>
      ) : intakes.isError ? (
        <LoadFailed what="the intakes" onRetry={() => void intakes.refetch()} />
      ) : intakes.data.items.length === 0 ? (
        <Card>
          <EmptyState icon="calendar" title="No intakes yet">
            Plan an intake to set when applications open and close.
          </EmptyState>
        </Card>
      ) : (
        <Card list role="list">
          {intakes.data.items.map((i) => (
            <div
              key={i.id}
              role="listitem"
              aria-label={`Intake ${i.code}`}
              className="space-y-2 px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-subhead text-ink">
                  Intake {i.code} · {i.academicSessionName}
                </p>
                <Badge tone={INTAKE_STATUS[i.status].tone}>{INTAKE_STATUS[i.status].word}</Badge>
              </div>
              <p className="text-body-sm text-ink-muted">
                Applications <CalendarDate value={i.opensOn} /> –{" "}
                <CalendarDate value={i.closesOn} /> · offers must be accepted within{" "}
                {i.offerAcceptanceDays} days
              </p>
              {i.status === "CLOSED" ? null : (
                <div className="flex flex-wrap gap-2">
                  {i.status === "PLANNED" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setConfirming({ intake: i, action: "open" });
                      }}
                    >
                      Open now
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setConfirming({ intake: i, action: "close" });
                    }}
                  >
                    Close now
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={
          confirming?.action === "open"
            ? `Open Intake ${confirming.intake.code} now?`
            : `Close Intake ${confirming?.intake.code ?? ""} now?`
        }
        confirmLabel={confirming?.action === "open" ? "Open intake" : "Close intake"}
        tone={confirming?.action === "open" ? "primary" : "danger"}
        onConfirm={() => (confirming ? act(confirming.intake, confirming.action) : undefined)}
      >
        {confirming?.action === "open" ? (
          <>
            Applicants can start and submit applications from now on, before the planned opening
            date. You can't move it back to planned.
          </>
        ) : (
          <>
            Applicants can no longer start or submit applications for this intake, even before the
            planned closing date. A closed intake can't be reopened.
          </>
        )}
      </ConfirmDialog>

      <PlanIntake
        open={planning}
        onOpenChange={setPlanning}
        onPlanned={async () => {
          await refresh();
          setPlanning(false);
        }}
      />
    </div>
  );
}

/** Planning the next intake, in a sheet over the list. */
function PlanIntake({
  open,
  onOpenChange,
  onPlanned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlanned: () => Promise<void>;
}) {
  const sessions = useQuery({ ...sessionsQuery, enabled: open });
  const formId = useId();
  const { busy, problem, fieldErrors, run } = useSubmit();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Plan an intake"
      description="Applications open in November and close in June, before the Academic Session starts."
      footer={
        <Button type="submit" form={formId} variant="primary" block loading={busy}>
          Plan intake
        </Button>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const d = new FormData(form);
          void run(async () => {
            await api<typeof admissions.createIntake>("POST", "/intakes", {
              body: {
                code: formText(d, "code"),
                academicSessionId: formText(d, "academicSessionId"),
                opensOn: formText(d, "opensOn"),
                closesOn: formText(d, "closesOn"),
              },
            });
            form.reset();
            await onPlanned();
          });
        }}
      >
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        {sessions.isError ? (
          <LoadFailed what="the Academic Sessions" onRetry={() => void sessions.refetch()} />
        ) : null}
        <TextField
          name="code"
          label="Intake (year students start, e.g. 2027)"
          required
          error={fieldErrors.code}
        />
        <Select
          name="academicSessionId"
          label="Academic Session students start in"
          required
          error={fieldErrors.academicSessionId}
        >
          {sessions.data?.items
            .filter((s) => s.status === "PLANNED")
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </Select>
        <TextField
          name="opensOn"
          type="date"
          label="Applications open (November)"
          required
          error={fieldErrors.opensOn}
        />
        <TextField
          name="closesOn"
          type="date"
          label="Applications close (June)"
          required
          error={fieldErrors.closesOn}
        />
      </form>
    </Sheet>
  );
}
