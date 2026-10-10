import type { BodyOf, Transcript, TranscriptRequest, results, transcripts } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { meQuery } from "../api/session";
import { Alert, formText } from "../components/form";
import { Time } from "../components/time";
import { useSubmit } from "../components/use-submit";

/** Hundredths as a decimal with two places, e.g. 460 → "4.60". */
function x100(v: number | null): string {
  if (v === null) return "–";
  return `${String(Math.trunc(v / 100))}.${String(v % 100).padStart(2, "0")}`;
}

/** Tenths of a credit, e.g. 30 → "3", 25 → "2.5". */
function credits(v: number): string {
  return v % 10 === 0 ? String(v / 10) : `${String(Math.trunc(v / 10))}.${String(v % 10)}`;
}

const STATUS_LABELS: Record<TranscriptRequest["status"], string> = {
  REQUESTED: "Waiting for the Registrar",
  APPROVED: "Approved: being issued",
  REJECTED: "Declined",
  ISSUED: "Issued",
  CANCELLED: "Cancelled",
};

const mineKey = ["my-transcripts"];
const input = "block w-full rounded border border-slate-300 px-3 py-2";

/**
 * A student's (or graduate's) transcripts (TRD §14.7): an unofficial one at once, or an official
 * one for a recipient once the Registrar issues it.
 */
export function MyTranscriptsPage() {
  const queryClient = useQueryClient();
  const mine = useQuery({
    queryKey: mineKey,
    queryFn: ({ signal }) =>
      api<typeof transcripts.getMyTranscripts>("GET", "/me/transcripts", { signal }),
  });
  const enrollments = useQuery({
    queryKey: ["my-results"],
    queryFn: ({ signal }) => api<typeof results.getMyResults>("GET", "/me/results", { signal }),
  });
  const { busy, error, run } = useSubmit();
  const [official, setOfficial] = useState(false);
  const programmes = enrollments.data?.programmes ?? [];
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
  return (
    <div className="space-y-4">
      <h1 className="text-title">Transcripts</h1>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {programmes.length > 1 ? (
        <label className="block text-sm">
          <span className="block text-slate-700">Programme</span>
          <select
            value={enrollmentId}
            onChange={(e) => {
              setChosen(e.target.value);
            }}
            className={input}
          >
            {programmes.map((p) => (
              <option key={p.programmeEnrollmentId} value={p.programmeEnrollmentId}>
                {p.programmeName} ({p.matricNumber})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {enrollmentId === "" ? null : (
        <div className="flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            disabled={busy}
            className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
            onClick={() => {
              ask({ kind: "UNOFFICIAL" });
            }}
          >
            Get an unofficial transcript
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-2"
            onClick={() => {
              setOfficial((v) => !v);
            }}
          >
            Request an official transcript
          </button>
        </div>
      )}
      {official ? (
        <form
          aria-label="Official transcript"
          className="space-y-2 rounded border border-slate-200 bg-white p-3 text-sm"
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
          <p className="text-slate-600">
            The Registrar checks and issues official transcripts. They include only approved
            semesters.
          </p>
          <label className="block">
            <span className="block text-slate-700">What it's for</span>
            <input name="purpose" required maxLength={500} className={input} />
          </label>
          <label className="block">
            <span className="block text-slate-700">Recipient</span>
            <input name="recipientName" required maxLength={200} className={input} />
          </label>
          <label className="block">
            <span className="block text-slate-700">Recipient's email</span>
            <input name="recipientEmail" type="email" required className={input} />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
          >
            Send request
          </button>
        </form>
      ) : null}
      <ul className="space-y-2 text-sm">
        {(mine.data?.items ?? []).map((r) => (
          <li
            key={r.id}
            className="rounded border border-slate-200 bg-white p-3"
            aria-label={r.transcript?.serialNo ?? `${r.kind} request`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {r.kind === "OFFICIAL" ? "Official" : "Unofficial"} · {r.programmeName}
              </span>
              <span className="text-slate-600">
                <Time value={r.createdAt} />
              </span>
            </div>
            <div className="text-slate-600">
              {r.transcript === null
                ? STATUS_LABELS[r.status]
                : `${r.transcript.serialNo} · ${r.transcript.status === "ISSUED" ? "Issued" : r.transcript.status === "REVOKED" ? "Revoked" : "Superseded"}`}
              {r.recipientName === null ? "" : ` · for ${r.recipientName}`}
            </div>
            {r.decisionReason === null ? null : (
              <div className="text-red-800">Reason: {r.decisionReason}</div>
            )}
            {r.transcript === null ? null : (
              <Link
                to="/transcripts/$transcriptId"
                params={{ transcriptId: r.transcript.id }}
                className="text-brand underline"
              >
                View transcript
              </Link>
            )}
          </li>
        ))}
      </ul>
      {mine.isSuccess && mine.data.items.length === 0 ? (
        <p className="text-sm text-slate-600">No transcripts yet.</p>
      ) : null}
    </div>
  );
}

/** A transcript as issued: rendered from its frozen snapshot, with how to verify it. */
export function TranscriptPage() {
  const { transcriptId } = useParams({ strict: false });
  const id = transcriptId ?? "";
  const doc = useQuery({
    queryKey: ["transcript", id],
    queryFn: ({ signal }) =>
      api<typeof transcripts.getTranscript>("GET", "/transcripts/:id", { params: { id }, signal }),
  });
  if (doc.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (doc.isError) return <Alert tone="error">We couldn't load the transcript.</Alert>;
  return (
    <div className="space-y-3">
      <a
        href={`/api/v1/transcripts/${doc.data.id}/download`}
        className="inline-block rounded bg-brand px-3 py-2 text-sm text-white"
      >
        Download PDF
      </a>
      <RegistrarActions transcript={doc.data} />
      <TranscriptView transcript={doc.data} />
    </div>
  );
}

/** The Registrar's actions on an issued transcript: email the PDF, or revoke it. */
function RegistrarActions({ transcript: d }: { transcript: Transcript }) {
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const { busy, error, run } = useSubmit();
  const [done, setDone] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const staff = me.data?.roles.staff.some((r) => r === "REGISTRAR" || r === "SYSTEM_ADMIN");
  if (staff !== true || d.status !== "ISSUED") return null;
  return (
    <section aria-label="Registrar actions" className="space-y-2 text-sm">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {done ? <Alert tone="success">{done}</Alert> : null}
      <form
        className="flex flex-wrap items-end gap-2"
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
        <label className="block">
          <span className="block text-slate-700">Email to (blank: the request's recipient)</span>
          <input name="to" type="email" className={input} />
        </label>
        <button type="submit" disabled={busy} className="rounded border border-slate-300 px-3 py-2">
          Email PDF
        </button>
      </form>
      {revoking ? (
        <form
          aria-label="Revoke transcript"
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = formText(new FormData(e.currentTarget), "reason");
            void run(async () => {
              await api<typeof transcripts.revokeTranscript>("POST", "/transcripts/:id/revoke", {
                params: { id: d.id },
                body: { reason },
              });
              await queryClient.invalidateQueries({ queryKey: ["transcript", d.id] });
            });
          }}
        >
          <label className="block">
            <span className="block text-slate-700">Why it's being revoked</span>
            <input name="reason" required maxLength={500} className={input} />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-red-700 px-3 py-2 text-white disabled:opacity-60"
          >
            Revoke transcript
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="text-red-700 underline"
          onClick={() => {
            setRevoking(true);
          }}
        >
          Revoke…
        </button>
      )}
    </section>
  );
}

function TranscriptView({ transcript: d }: { transcript: Transcript }) {
  const s = d.snapshot;
  const verifyUrl = `${window.location.origin}/verify/${d.verificationCode}`;
  return (
    <article className="space-y-4 rounded border border-slate-200 bg-white p-4 text-sm">
      <header className="space-y-1">
        <h1 className="text-title">{s.institution.name}</h1>
        <p className="font-medium">
          {s.kind === "OFFICIAL" ? "Official" : "Unofficial"} transcript · {d.serialNo}
        </p>
        {d.status === "ISSUED" ? null : (
          <Alert tone="error">
            This transcript was {d.status === "REVOKED" ? "revoked" : "superseded"}
            {d.revokeReason === null ? "" : `: ${d.revokeReason}`}.
          </Alert>
        )}
        <p>
          {s.student.legalName} · {s.student.matricNumber}
        </p>
        <p>
          {s.programme.name} ({s.programme.code}) · as of {s.asOf}
        </p>
      </header>
      {s.semesters.map((sem) => (
        <section key={`${sem.sessionCode}-${sem.semesterName}`} className="space-y-1">
          <h3 className="font-medium">
            {sem.semesterName}, {sem.sessionCode}
            {sem.provisional ? (
              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-amber-900">
                Provisional
              </span>
            ) : null}
          </h3>
          <div
            role="region"
            aria-label="Courses"
            tabIndex={0}
            className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <table className="min-w-full text-left">
              <thead className="text-slate-600">
                <tr>
                  <th className="pr-3 font-normal">Course</th>
                  <th className="pr-3 font-normal">Credits</th>
                  <th className="pr-3 font-normal">%</th>
                  <th className="font-normal">Grade</th>
                </tr>
              </thead>
              <tbody>
                {sem.courses.map((c) => (
                  <tr key={`${c.code}-${String(c.attemptNo)}`}>
                    <td className="pr-3">
                      {c.code} {c.title}
                      {c.repeated ? " (repeated)" : ""}
                    </td>
                    <td className="pr-3">{credits(c.creditsX10)}</td>
                    <td className="pr-3">{x100(c.finalPctX100)}</td>
                    <td>{c.letter ?? c.resultKind.toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-slate-700">
            GPA {x100(sem.gpaX100)} · CGPA {x100(sem.cgpaX100)}
          </p>
        </section>
      ))}
      <section className="space-y-1">
        <p className="font-medium">
          CGPA {x100(s.totals.cgpaX100)} · {credits(s.totals.creditsEarnedX10)} credits earned
        </p>
        {s.award === null ? null : (
          <p>
            Awarded {s.programme.awardType === "CERTIFICATE" ? "the Certificate" : "the Diploma"}{" "}
            with {s.award.awardClass} on {s.award.awardedOn} · {s.award.certificateNo}
          </p>
        )}
      </section>
      <footer className="space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
        <p>
          Grades:{" "}
          {s.legend.bands
            .map((b) => `${b.letter} ${x100(b.minX100)}–${x100(b.maxX100)} (${x100(b.pointsX100)})`)
            .join(" · ")}
        </p>
        <p>
          Check it at <span className="break-all">{verifyUrl}</span> · code{" "}
          <strong>{d.verificationCode}</strong> · SHA-256 {d.snapshotSha256.slice(0, 16)}…
        </p>
      </footer>
    </article>
  );
}

/** The Registrar's transcript requests: approve or decline official ones, then issue. */
export function RegistrarTranscriptsPage() {
  const [status, setStatus] = useState<TranscriptRequest["status"] | "">("REQUESTED");
  const list = useQuery({
    queryKey: ["transcript-requests", status],
    queryFn: ({ signal }) =>
      api<typeof transcripts.listTranscriptRequests>("GET", "/transcript-requests", {
        query: status === "" ? {} : { status },
        signal,
      }),
  });
  return (
    <div className="space-y-4">
      <h1 className="text-title">Transcript requests</h1>
      <label className="block text-sm">
        <span className="block text-slate-700">Show</span>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as TranscriptRequest["status"] | "");
          }}
          className="rounded border border-slate-300 px-2 py-2"
        >
          <option value="REQUESTED">Waiting</option>
          <option value="APPROVED">Approved</option>
          <option value="ISSUED">Issued</option>
          <option value="REJECTED">Declined</option>
          <option value="">All</option>
        </select>
      </label>
      {list.isSuccess && list.data.items.length === 0 ? (
        <p className="text-sm text-slate-600">Nothing here.</p>
      ) : null}
      <ul className="space-y-2 text-sm">
        {(list.data?.items ?? []).map((r) => (
          <RequestItem key={r.id} request={r} />
        ))}
      </ul>
    </div>
  );
}

function RequestItem({ request: r }: { request: TranscriptRequest }) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const [declining, setDeclining] = useState(false);
  const act = (action: () => Promise<unknown>) => {
    void run(async () => {
      await action();
      setDeclining(false);
      await queryClient.invalidateQueries({ queryKey: ["transcript-requests"] });
    });
  };
  return (
    <li
      className="space-y-1 rounded border border-slate-200 bg-white p-3"
      aria-label={r.studentName}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {r.studentName} <span className="font-normal text-slate-500">{r.matricNumber}</span>
        </span>
        <span>{r.kind === "OFFICIAL" ? "Official" : "Unofficial"}</span>
      </div>
      {r.purpose === null ? null : (
        <p>
          {r.purpose} · for {r.recipientName} ({r.recipientEmail})
        </p>
      )}
      <p className="text-slate-600">
        {STATUS_LABELS[r.status]}
        {r.transcript === null ? "" : ` · ${r.transcript.serialNo}`}
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        {r.status === "REQUESTED" ? (
          <button
            type="button"
            disabled={busy}
            className="text-brand underline"
            onClick={() => {
              act(() =>
                api<typeof transcripts.approveTranscriptRequest>(
                  "POST",
                  "/transcript-requests/:id/approve",
                  { params: { id: r.id } },
                ),
              );
            }}
          >
            Approve
          </button>
        ) : null}
        {r.status === "APPROVED" ? (
          <button
            type="button"
            disabled={busy}
            className="rounded bg-brand px-3 py-1 text-white disabled:opacity-60"
            onClick={() => {
              act(() =>
                api<typeof transcripts.issueTranscript>("POST", "/transcript-requests/:id/issue", {
                  params: { id: r.id },
                  headers: { "idempotency-key": crypto.randomUUID() },
                }),
              );
            }}
          >
            Issue
          </button>
        ) : null}
        {r.status === "REQUESTED" || r.status === "APPROVED" ? (
          <button
            type="button"
            className="text-red-700 underline"
            onClick={() => {
              setDeclining((v) => !v);
            }}
          >
            Decline
          </button>
        ) : null}
        {r.transcript === null ? null : (
          <Link
            to="/transcripts/$transcriptId"
            params={{ transcriptId: r.transcript.id }}
            className="text-brand underline"
          >
            View
          </Link>
        )}
      </div>
      {declining ? (
        <form
          aria-label="Decline request"
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = formText(new FormData(e.currentTarget), "reason");
            act(() =>
              api<typeof transcripts.rejectTranscriptRequest>(
                "POST",
                "/transcript-requests/:id/reject",
                { params: { id: r.id }, body: { reason } },
              ),
            );
          }}
        >
          <label className="block">
            <span className="block text-slate-700">Reason (the student sees it)</span>
            <input name="reason" required maxLength={500} className={input} />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded border border-slate-300 px-3 py-1"
          >
            Decline request
          </button>
        </form>
      ) : null}
    </li>
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
