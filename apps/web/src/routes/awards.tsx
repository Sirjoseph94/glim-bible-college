import type { Award, AwardCandidate, results } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { CalendarDate } from "../components/time";
import { useSubmit } from "../components/use-submit";
import { Badge } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  bodyCell,
  DataTable,
  headCell,
  numericCell,
  stickyCell,
} from "../components/ui/data-table";
import { ConfirmDialog } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { cn } from "../design/cn";
import { hundredths } from "../design/format";
import { Icon } from "../design/icons";

const candidatesKey = ["award-candidates"];
const awardsKey = ["awards"];

/**
 * The Registrar's awards (TRD §14.6): propose an award to see the final CGPA, award class and the
 * requirements checklist, then confer it, which numbers the certificate (and graduates the student unless they have another active programme).
 */
export function AwardsPage() {
  const candidates = useQuery({
    queryKey: candidatesKey,
    queryFn: ({ signal }) =>
      api<typeof results.listAwardCandidates>("GET", "/awards/candidates", { query: {}, signal }),
  });
  const conferred = useQuery({
    queryKey: awardsKey,
    queryFn: ({ signal }) =>
      api<typeof results.listAwards>("GET", "/awards", { query: { status: "CONFERRED" }, signal }),
  });
  const [proposal, setProposal] = useState<Award | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader
        overline="Registrar"
        title="Awards"
        meta="Propose an award to check the final CGPA, award class and requirements, then confer it."
      />
      {proposal !== null ? (
        <Proposal
          key={`${proposal.id}:${String(proposal.version)}`}
          award={proposal}
          onDone={(a) => {
            setProposal(a);
          }}
        />
      ) : null}
      <section className="space-y-3">
        <h2 className="text-heading">Students</h2>
        {candidates.isPending ? (
          <SkeletonGroup label="Loading the students">
            <Skeleton className="h-40" />
          </SkeletonGroup>
        ) : candidates.isError ? (
          <LoadFailed what="the students" onRetry={() => void candidates.refetch()} />
        ) : candidates.data.items.length === 0 ? (
          <Card>
            <EmptyState icon="users" title="No students on a programme" headingLevel={3}>
              Students with an active programme enrollment appear here.
            </EmptyState>
          </Card>
        ) : (
          <DataTable caption="Students" minWidth="min-w-160">
            <thead>
              <tr>
                <th scope="col" className={cn(headCell, stickyCell, "bg-surface-sunken")}>
                  Student
                </th>
                <th scope="col" className={headCell}>
                  Matric Number
                </th>
                <th scope="col" className={headCell}>
                  Programme
                </th>
                <th scope="col" className={`${headCell} ${numericCell}`}>
                  CGPA
                </th>
                <th scope="col" className={headCell}>
                  Award
                </th>
                <th scope="col" className={headCell}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {candidates.data.items.map((c) => (
                <Candidate
                  key={c.programmeEnrollmentId}
                  candidate={c}
                  onProposed={(a) => {
                    setProposal(a);
                    window.scrollTo({ top: 0 });
                  }}
                />
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-heading">Conferred</h2>
        {conferred.isPending ? (
          <SkeletonGroup label="Loading the conferred awards">
            <Skeleton className="h-32" />
          </SkeletonGroup>
        ) : conferred.isError ? (
          <LoadFailed what="the conferred awards" onRetry={() => void conferred.refetch()} />
        ) : conferred.data.items.length === 0 ? (
          <Card>
            <EmptyState icon="award" title="None yet" headingLevel={3}>
              Awards appear here once they are conferred.
            </EmptyState>
          </Card>
        ) : (
          <DataTable caption="Conferred awards" minWidth="min-w-180">
            <thead>
              <tr>
                <th scope="col" className={cn(headCell, stickyCell, "bg-surface-sunken")}>
                  Student
                </th>
                <th scope="col" className={headCell}>
                  Programme
                </th>
                <th scope="col" className={headCell}>
                  Award class
                </th>
                <th scope="col" className={`${headCell} ${numericCell}`}>
                  CGPA
                </th>
                <th scope="col" className={headCell}>
                  Certificate
                </th>
                <th scope="col" className={headCell}>
                  Awarded on
                </th>
              </tr>
            </thead>
            <tbody>
              {conferred.data.items.map((a) => (
                <tr key={a.id}>
                  <th scope="row" className={cn(bodyCell, stickyCell, "text-left font-normal")}>
                    {a.studentName}
                  </th>
                  <td className={bodyCell}>{a.programmeCode}</td>
                  <td className={bodyCell}>{a.awardClass}</td>
                  <td className={`${bodyCell} ${numericCell}`}>{hundredths(a.cgpaX100)}</td>
                  <td className={`${bodyCell} font-mono text-code`}>{a.certificateNo}</td>
                  <td className={bodyCell}>
                    <CalendarDate value={a.awardedOn} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    </div>
  );
}

const AWARD_STATUS: Record<Award["status"], { tone: "warning" | "success"; word: string }> = {
  DRAFT: { tone: "warning", word: "Draft" },
  APPROVED: { tone: "success", word: "Approved" },
  CONFERRED: { tone: "success", word: "Conferred" },
};

function Candidate({
  candidate: c,
  onProposed,
}: {
  candidate: AwardCandidate;
  onProposed: (a: Award) => void;
}) {
  const { busy, problem, run } = useSubmit();
  return (
    <tr>
      <th scope="row" className={cn(bodyCell, stickyCell, "text-left font-normal")}>
        {c.studentName}
        {problem !== null ? (
          <span role="alert" className="mt-1 block text-body-sm text-danger">
            {problem.title}
          </span>
        ) : null}
      </th>
      <td className={`${bodyCell} font-mono text-code`}>{c.matricNumber}</td>
      <td className={bodyCell}>{c.programmeCode}</td>
      <td className={`${bodyCell} ${numericCell}`}>{hundredths(c.cgpaX100)}</td>
      <td className={bodyCell}>
        {c.award === null ? (
          <span className="text-ink-muted">Not proposed</span>
        ) : (
          <Badge tone={AWARD_STATUS[c.award.status].tone}>
            {AWARD_STATUS[c.award.status].word}
          </Badge>
        )}
      </td>
      <td className={`${bodyCell} text-right`}>
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={() => {
            void run(async () => {
              onProposed(
                await api<typeof results.proposeAward>(
                  "POST",
                  "/programme-enrollments/:id/award/propose",
                  { params: { id: c.programmeEnrollmentId } },
                ),
              );
            });
          }}
        >
          {c.award === null ? "Propose award" : "Check award again"}
        </Button>
      </td>
    </tr>
  );
}

/**
 * The proposed award and its requirements. Conferring is consequential (it numbers the
 * certificate and may graduate the student), so it asks first and says who it affects.
 */
function Proposal({ award: a, onDone }: { award: Award; onDone: (a: Award) => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const ready = a.awardClass !== null && a.requirements.every((r) => r.met);
  return (
    <section
      aria-label="Award proposal"
      className="space-y-4 rounded-md border border-line bg-surface-raised p-4"
    >
      <div className="space-y-1">
        <h2 className="text-heading">
          {a.studentName} · {a.programmeName}
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-body-sm">
          <span>
            Final CGPA <span className="tabular-nums">{hundredths(a.cgpaX100)}</span>
          </span>
          {a.awardClass === null ? (
            <Badge tone="warning">No award (below the minimum CGPA)</Badge>
          ) : (
            <Badge tone="brand">{a.awardClass}</Badge>
          )}
        </p>
      </div>
      <ul className="space-y-2" aria-label="Requirements">
        {a.requirements.map((r) => (
          <li key={r.key} className="flex items-start gap-2 text-body-sm">
            <span className={`mt-0.5 shrink-0 ${r.met ? "text-success" : "text-danger"}`}>
              <Icon name={r.met ? "check" : "alert"} size={16} />
            </span>
            <span className="min-w-0 flex-1">
              {r.label}
              {r.detail === null ? "" : ` — ${r.detail}`}
            </span>
            <Badge tone={r.met ? "success" : "danger"}>{r.met ? "Met" : "Not met"}</Badge>
          </li>
        ))}
      </ul>
      {a.status === "CONFERRED" ? (
        <Banner tone="success" title="Award conferred">
          Conferred on <CalendarDate value={a.awardedOn} />: certificate{" "}
          <span className="font-mono text-code">{a.certificateNo}</span>.
        </Banner>
      ) : ready ? (
        <>
          <Button
            onClick={() => {
              setConfirming(true);
            }}
          >
            Confer {a.awardClass}
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Confer the ${a.programmeName} on ${a.studentName}?`}
            confirmLabel="Confer award"
            onConfirm={async () => {
              const done = await api<typeof results.confirmAward>("POST", "/awards/:id/confirm", {
                params: { id: a.id },
                headers: { "idempotency-key": crypto.randomUUID() },
              });
              await queryClient.invalidateQueries({ queryKey: candidatesKey });
              await queryClient.invalidateQueries({ queryKey: awardsKey });
              setConfirming(false);
              onDone(done);
            }}
          >
            {a.studentName} ({a.matricNumber}) is awarded {a.awardClass}, final CGPA{" "}
            {hundredths(a.cgpaX100)}. The certificate is numbered now and the student leaves the
            list of students on {a.programmeCode}.
          </ConfirmDialog>
        </>
      ) : (
        <p className="text-body-sm text-ink-muted">
          It can be conferred once every requirement is met.
        </p>
      )}
    </section>
  );
}
