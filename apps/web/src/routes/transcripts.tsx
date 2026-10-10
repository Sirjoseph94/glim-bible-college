import type { BodyOf, Transcript, TranscriptRequest, transcripts } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { meQuery } from "../api/session";
import { Alert, formText } from "../components/form";
import { Time } from "../components/time";
import { useSubmit } from "../components/use-submit";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { isNotAvailable, LoadFailed, NotAvailable } from "../components/app/page-states";
import { useDetailBar } from "../components/app/shell-parts";
import { bodyCell, DataTable, headCell, numericCell } from "../components/ui/data-table";
import { ConfirmDialog, Sheet } from "../components/ui/dialog";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { cn } from "../design/cn";
import { Card, cardClass } from "../components/ui/card";
import { Select, TextField } from "../components/ui/field";
import { credits, hundredths } from "../design/format";

const STATUS_LABELS: Record<TranscriptRequest["status"], string> = {
  REQUESTED: "Waiting for the Registrar",
  APPROVED: "Approved: being issued",
  REJECTED: "Declined",
  ISSUED: "Issued",
  CANCELLED: "Cancelled",
};

const mineKey = ["my-transcripts"];

/**
 * A student's (or graduate's) transcripts, on the Results page (§11.6, decision UI-Q8): an
 * unofficial one at once, or an official one for a recipient once the Registrar issues it.
 */
export function TranscriptsSection({
  programmes,
}: {
  programmes: { programmeEnrollmentId: string; programmeName: string; matricNumber: string }[];
}) {
  const queryClient = useQueryClient();
  const mine = useQuery({
    queryKey: mineKey,
    queryFn: ({ signal }) =>
      api<typeof transcripts.getMyTranscripts>("GET", "/me/transcripts", { signal }),
  });
  const { busy, problem, run } = useSubmit();
  const [official, setOfficial] = useState(false);
  const [chosen, setChosen] = useState("");
  const enrollmentId = chosen === "" ? (programmes[0]?.programmeEnrollmentId ?? "") : chosen;
  const ask = (body: BodyOf<typeof transcripts.requestTranscript>) => {
    void run(async () => {
      await api<typeof transcripts.requestTranscript>(
        "POST",
        "/programme-enrollments/:id/transcript-requests",
        { params: { id: enrollmentId }, body },
      );
      setOfficial(false);
      await queryClient.invalidateQueries({ queryKey: mineKey });
    });
  };
  const items = mine.data?.items ?? [];
  return (
    <section className="space-y-3" aria-label="Transcripts">
      <h2 className="text-heading">Transcripts</h2>
      <p className="text-body-sm text-ink-muted">
        An unofficial transcript is ready at once. The Registrar checks and issues official ones,
        with approved semesters only.
      </p>
      {problem && !official ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {programmes.length > 1 ? (
        <Select
          label="Programme"
          value={enrollmentId}
          onChange={(e) => {
            setChosen(e.target.value);
          }}
        >
          {programmes.map((p) => (
            <option key={p.programmeEnrollmentId} value={p.programmeEnrollmentId}>
              {p.programmeName} ({p.matricNumber})
            </option>
          ))}
        </Select>
      ) : null}
      {enrollmentId === "" ? null : (
        <div className="flex flex-col gap-2 md:flex-row">
          <Button
            variant="secondary"
            icon="file"
            loading={busy && !official}
            onClick={() => {
              ask({ kind: "UNOFFICIAL" });
            }}
          >
            Get an unofficial transcript
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setOfficial(true);
            }}
          >
            Request an official transcript
          </Button>
        </div>
      )}
      <Sheet
        open={official}
        onOpenChange={setOfficial}
        title="Request an official transcript"
        description="The Registrar checks and issues official transcripts. They include only approved semesters."
      >
        <form
          aria-label="Official transcript"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            ask({
              kind: "OFFICIAL",
              purpose: formText(data, "purpose"),
              recipientName: formText(data, "recipientName"),
              recipientEmail: formText(data, "recipientEmail"),
            });
          }}
        >
          {problem ? (
            <Banner tone="danger" title={problem.title}>
              {problem.body}
            </Banner>
          ) : null}
          <TextField name="purpose" label="What it's for" required maxLength={500} />
          <TextField name="recipientName" label="Recipient" required maxLength={200} />
          <TextField
            name="recipientEmail"
            label="Recipient's email"
            type="email"
            autoComplete="email"
            required
          />
          <Button type="submit" variant="primary" block loading={busy}>
            Send request
          </Button>
        </form>
      </Sheet>
      {items.length > 0 ? (
        <Card list role="list">
          {items.map((r) => (
            <div
              key={r.id}
              role="listitem"
              aria-label={r.transcript?.serialNo ?? `${r.kind} request`}
              className="space-y-1 px-4 py-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-subhead">
                  {r.kind === "OFFICIAL" ? "Official" : "Unofficial"} · {r.programmeName}
                </span>
                <span className="text-meta text-ink-muted">
                  <Time value={r.createdAt} />
                </span>
              </div>
              <p className="text-body-sm text-ink-muted">
                {r.transcript === null ? (
                  STATUS_LABELS[r.status]
                ) : (
                  <>
                    <span className="font-mono text-code">{r.transcript.serialNo}</span> ·{" "}
                    {r.transcript.status === "ISSUED"
                      ? "Issued"
                      : r.transcript.status === "REVOKED"
                        ? "Revoked"
                        : "Superseded"}
                  </>
                )}
                {r.recipientName === null ? "" : ` · for ${r.recipientName}`}
              </p>
              {r.decisionReason === null ? null : (
                <p className="text-body-sm text-danger">Reason: {r.decisionReason}</p>
              )}
              {r.transcript === null ? null : (
                <Link
                  to="/transcripts/$transcriptId"
                  params={{ transcriptId: r.transcript.id }}
                  className="inline-flex min-h-tap items-center text-body-sm font-semibold text-brand underline"
                >
                  View transcript
                </Link>
              )}
            </div>
          ))}
        </Card>
      ) : mine.isSuccess ? (
        <p className="text-body-sm text-ink-muted">No transcripts yet.</p>
      ) : null}
    </section>
  );
}

/** A transcript as issued: rendered from its frozen snapshot, with how to verify it. */
export function TranscriptPage() {
  const { transcriptId } = useParams({ from: "/transcripts/$transcriptId" });
  const me = useQuery(meQuery);
  const isRegistrar =
    me.data?.roles.staff.some((r) => r === "REGISTRAR" || r === "SYSTEM_ADMIN") ?? false;
  useDetailBar(
    isRegistrar
      ? { back: { to: "/results/semesters", label: "Semester results" } }
      : { back: { to: "/results", label: "Results" } },
  );
  const doc = useQuery({
    queryKey: ["transcript", transcriptId],
    queryFn: ({ signal }) =>
      api<typeof transcripts.getTranscript>("GET", "/transcripts/:id", {
        params: { id: transcriptId },
        signal,
      }),
  });
  if (doc.isPending)
    return (
      <SkeletonGroup label="Loading the transcript">
        <Skeleton className="h-80" />
      </SkeletonGroup>
    );
  if (doc.isError)
    return isNotAvailable(doc.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="the transcript" onRetry={() => void doc.refetch()} />
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
        <a
          href={`/api/v1/transcripts/${doc.data.id}/download`}
          className={buttonClass({ variant: "primary" })}
        >
          Download PDF
        </a>
      </div>
      {isRegistrar ? <RegistrarActions transcript={doc.data} /> : null}
      <TranscriptView transcript={doc.data} />
    </div>
  );
}

/** The Registrar's actions on an issued transcript: email the PDF, or revoke it (§10.5). */
function RegistrarActions({ transcript: d }: { transcript: Transcript }) {
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  const [done, setDone] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  if (d.status !== "ISSUED") return null;
  return (
    <section aria-label="Registrar actions" className="space-y-3">
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {done ? <Banner tone="success">{done}</Banner> : null}
      <form
        className="flex flex-col gap-3 md:flex-row md:items-end"
        aria-label="Email the PDF"
        onSubmit={(e) => {
          e.preventDefault();
          const to = formText(new FormData(e.currentTarget), "to").trim();
          void run(async () => {
            const sent = await api<typeof transcripts.sendTranscript>(
              "POST",
              "/transcripts/:id/send",
              { params: { id: d.id }, body: to === "" ? {} : { to } },
            );
            setDone(`The PDF is on its way to ${sent.to}.`);
          });
        }}
      >
        <div className="md:flex-1">
          <TextField
            name="to"
            type="email"
            label="Email to"
            optional
            hint="Leave empty to send it to the request's recipient."
          />
        </div>
        <Button type="submit" variant="secondary" icon="upload" loading={busy}>
          Email PDF
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            setRevoking(true);
          }}
        >
          Revoke transcript
        </Button>
      </form>
      <ConfirmDialog
        open={revoking}
        onOpenChange={setRevoking}
        title={`Revoke ${d.serialNo}?`}
        confirmLabel="Revoke transcript"
        tone="danger"
        reason={{ label: "Why it's being revoked", minLength: 1 }}
        onConfirm={async (reason) => {
          await api<typeof transcripts.revokeTranscript>("POST", "/transcripts/:id/revoke", {
            params: { id: d.id },
            body: { reason },
          });
          setRevoking(false);
          await queryClient.invalidateQueries({ queryKey: ["transcript", d.id] });
        }}
      >
        Anyone who checks its code will see that it was revoked, with your reason. This can't be
        undone.
      </ConfirmDialog>
    </section>
  );
}

function TranscriptView({ transcript: d }: { transcript: Transcript }) {
  const s = d.snapshot;
  const verifyUrl = `${window.location.origin}/verify/${d.verificationCode}`;
  return (
    <article className={`${cardClass()} space-y-5`}>
      <header className="space-y-1">
        <h1 className="text-title">{s.institution.name}</h1>
        <p className="text-subhead">
          {s.kind === "OFFICIAL" ? "Official" : "Unofficial"} transcript · {d.serialNo}
        </p>
        {d.status === "ISSUED" ? null : (
          <Banner tone="danger">
            This transcript was {d.status === "REVOKED" ? "revoked" : "superseded"}
            {d.revokeReason === null ? "" : `: ${d.revokeReason}`}.
          </Banner>
        )}
        <p className="text-body-sm">
          {s.student.legalName} · <span className="font-mono">{s.student.matricNumber}</span>
        </p>
        <p className="text-body-sm text-ink-muted">
          {s.programme.name} ({s.programme.code}) · as of {s.asOf}
        </p>
      </header>
      {s.semesters.map((sem) => (
        <section key={`${sem.sessionCode}-${sem.semesterName}`} className="space-y-2">
          <h2 className="flex flex-wrap items-center gap-2 text-heading">
            {sem.semesterName}, {sem.sessionCode}
            {sem.provisional ? <Badge status="provisional" /> : null}
          </h2>
          <DataTable
            caption={`Courses, ${sem.semesterName} ${sem.sessionCode}`}
            minWidth="min-w-120"
          >
            <thead>
              <tr>
                <th scope="col" className={headCell}>
                  Course
                </th>
                <th scope="col" className={cn(headCell, numericCell)}>
                  Credits
                </th>
                <th scope="col" className={cn(headCell, numericCell)}>
                  %
                </th>
                <th scope="col" className={headCell}>
                  Grade
                </th>
              </tr>
            </thead>
            <tbody>
              {sem.courses.map((c) => (
                <tr key={`${c.code}-${String(c.attemptNo)}`}>
                  <td className={cn(bodyCell, "whitespace-normal")}>
                    <span className="font-mono text-code">{c.code}</span> {c.title}
                    {c.repeated ? " (repeated)" : ""}
                  </td>
                  <td className={cn(bodyCell, numericCell)}>{credits(c.creditsX10)}</td>
                  <td className={cn(bodyCell, numericCell)}>{hundredths(c.finalPctX100)}</td>
                  <td className={cn(bodyCell, "font-mono font-semibold")}>
                    {c.letter ?? c.resultKind.toLowerCase()}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <p className="text-body-sm text-ink-muted">
            GPA {hundredths(sem.gpaX100)} · CGPA {hundredths(sem.cgpaX100)}
          </p>
        </section>
      ))}
      <section className="space-y-1">
        <p className="text-subhead">
          CGPA {hundredths(s.totals.cgpaX100)} · {credits(s.totals.creditsEarnedX10)} credits earned
        </p>
        {s.award === null ? null : (
          <p className="text-body-sm">
            Awarded {s.programme.awardType === "CERTIFICATE" ? "the Certificate" : "the Diploma"}{" "}
            with {s.award.awardClass} on {s.award.awardedOn} · {s.award.certificateNo}
          </p>
        )}
      </section>
      <footer className="space-y-1 border-t border-line pt-3 text-meta text-ink-muted">
        <p>
          Grades:{" "}
          {s.legend.bands
            .map(
              (b) =>
                `${b.letter} ${hundredths(b.minX100)}–${hundredths(b.maxX100)} (${hundredths(b.pointsX100)})`,
            )
            .join(" · ")}
        </p>
        <p>
          Check it at <span className="break-all">{verifyUrl}</span> · code{" "}
          <strong className="font-mono text-ink">{d.verificationCode}</strong> · SHA-256{" "}
          {d.snapshotSha256.slice(0, 16)}…
        </p>
      </footer>
    </article>
  );
}

/**
 * The public check (TRD §14.7): anyone with a transcript's code sees whether it's genuine and
 * still valid, with the minimum of personal data.
 */
export function VerifyPage() {
  const { code } = useParams({ strict: false });
  const check = useQuery({
    queryKey: ["verify", code],
    retry: false,
    queryFn: ({ signal }) =>
      api<typeof transcripts.verifyTranscript>("GET", "/public/transcripts/:code", {
        params: { code: code ?? "" },
        signal,
      }),
  });
  return (
    <div className="space-y-4">
      <h1 className="text-title">Verify a transcript</h1>
      {check.isPending ? <div className="h-24 animate-pulse rounded bg-slate-200" /> : null}
      {check.isError ? (
        <Alert tone="error">No transcript has the code {code}. Check it and try again.</Alert>
      ) : null}
      {check.isSuccess ? (
        <div className="space-y-2 rounded border border-slate-200 bg-white p-4 text-sm">
          {check.data.valid ? (
            <Alert tone="success">This transcript is genuine and valid.</Alert>
          ) : (
            <Alert tone="error">
              This transcript was{" "}
              {check.data.status === "REVOKED" ? "revoked" : "replaced by a newer one"} and is no
              longer valid.
            </Alert>
          )}
          {/* eslint-disable-next-line glim/design-tokens -- design-exception: geometry, label column width */}
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
            <dt className="text-slate-600">Issued by</dt>
            <dd>{check.data.institutionName}</dd>
            <dt className="text-slate-600">Programme</dt>
            <dd>{check.data.programmeName}</dd>
            <dt className="text-slate-600">Student</dt>
            <dd>{check.data.studentInitials}</dd>
            <dt className="text-slate-600">Issued</dt>
            <dd>
              <Time value={check.data.issuedAt} />
            </dd>
            <dt className="text-slate-600">Records as of</dt>
            <dd>{check.data.asOf}</dd>
            <dt className="text-slate-600">SHA-256</dt>
            <dd className="break-all font-mono text-xs">{check.data.snapshotSha256}</dd>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
