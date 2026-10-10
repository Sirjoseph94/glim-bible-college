import type { Award, AwardCandidate, results } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { Alert } from "../components/form";
import { useSubmit } from "../components/use-submit";

/** Hundredths as a decimal with two places, e.g. 460 → "4.60". */
function x100(v: number | null): string {
  if (v === null) return "–";
  return `${String(Math.trunc(v / 100))}.${String(v % 100).padStart(2, "0")}`;
}

const candidatesKey = ["award-candidates"];
const awardsKey = ["awards"];

/**
 * The Registrar's awards (TRD §14.6): propose an award to see the final CGPA, award class and the
 * requirements checklist, then confer it, which numbers the certificate and graduates the student.
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
  if (candidates.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (candidates.isError) return <Alert tone="error">We couldn't load the students.</Alert>;
  return (
    <div className="space-y-4">
      <h1 className="text-title">Awards</h1>
      {proposal !== null ? (
        <Proposal
          key={`${proposal.id}:${String(proposal.version)}`}
          award={proposal}
          onDone={(a) => {
            setProposal(a);
          }}
        />
      ) : null}
      <section className="space-y-2">
        <h3 className="font-medium">Students</h3>
        <ul className="space-y-2 text-sm">
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
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-medium">Conferred</h3>
        {conferred.data?.items.length === 0 ? (
          <p className="text-sm text-slate-600">None yet.</p>
        ) : null}
        <ul className="space-y-1 text-sm">
          {(conferred.data?.items ?? []).map((a) => (
            <li key={a.id} className="rounded border border-slate-200 bg-white p-2">
              <span className="font-medium">{a.studentName}</span> · {a.programmeCode} ·{" "}
              {a.awardClass} · CGPA {x100(a.cgpaX100)} · {a.certificateNo} · {a.awardedOn}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Candidate({
  candidate: c,
  onProposed,
}: {
  candidate: AwardCandidate;
  onProposed: (a: Award) => void;
}) {
  const { busy, error, run } = useSubmit();
  return (
    <li className="rounded border border-slate-200 bg-white p-3" aria-label={c.studentName}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <span className="font-medium">{c.studentName}</span>{" "}
          <span className="text-slate-500">
            {c.matricNumber} · {c.programmeCode}
          </span>
        </span>
        <span>CGPA {x100(c.cgpaX100)}</span>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <button
        type="button"
        disabled={busy}
        className="text-brand underline disabled:opacity-60"
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
      </button>
    </li>
  );
}

function Proposal({ award: a, onDone }: { award: Award; onDone: (a: Award) => void }) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const ready = a.awardClass !== null && a.requirements.every((r) => r.met);
  return (
    <section
      aria-label="Award proposal"
      className="space-y-2 rounded border border-slate-200 bg-white p-3 text-sm"
    >
      <h3 className="font-medium">
        {a.studentName} · {a.programmeName}
      </h3>
      <p>
        Final CGPA {x100(a.cgpaX100)} ·{" "}
        {a.awardClass === null ? (
          <strong>No award (below the minimum CGPA)</strong>
        ) : (
          <strong>{a.awardClass}</strong>
        )}
      </p>
      <ul className="space-y-1">
        {a.requirements.map((r) => (
          <li key={r.key} className={r.met ? "text-green-800" : "text-red-800"}>
            {r.met ? "✓" : "✗"} {r.label}
            {r.detail === null ? "" : ` — ${r.detail}`}
          </li>
        ))}
      </ul>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {a.status === "CONFERRED" ? (
        <Alert tone="success">
          Conferred on {a.awardedOn}: certificate {a.certificateNo}.
        </Alert>
      ) : ready ? (
        <button
          type="button"
          disabled={busy}
          className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
          onClick={() => {
            void run(async () => {
              const done = await api<typeof results.confirmAward>("POST", "/awards/:id/confirm", {
                params: { id: a.id },
                headers: { "idempotency-key": crypto.randomUUID() },
              });
              await queryClient.invalidateQueries({ queryKey: candidatesKey });
              await queryClient.invalidateQueries({ queryKey: awardsKey });
              onDone(done);
            });
          }}
        >
          Confer {a.awardClass}
        </button>
      ) : (
        <p className="text-slate-600">It can be conferred once every requirement is met.</p>
      )}
    </section>
  );
}
