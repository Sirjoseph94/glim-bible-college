import type { applications } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  applicationQuery,
  ENDED,
  mineQuery,
  STATUS_LABEL,
  WITHDRAWABLE,
} from "../api/applications";
import { api } from "../api/client";
import { Alert } from "../components/form";
import { Time } from "../components/time";
import { useSubmit } from "../components/use-submit";

/** The applicant's status page: reference number, status timeline, withdraw (TRD §10.2–10.3). */
export function ApplicationPage() {
  const mine = useQuery(mineQuery);
  if (mine.isPending) return <div className="h-48 animate-pulse rounded bg-slate-200" />;
  if (mine.isError)
    return <Alert tone="error">We couldn't load your application. Please try again.</Alert>;
  const latest = mine.data.items[0];
  if (latest === undefined)
    return (
      <div className="space-y-2">
        <h1 className="text-title">Your application</h1>
        <p>
          You haven't started an application yet.{" "}
          <Link to="/apply" className="text-brand underline">
            See how to apply
          </Link>
          .
        </p>
      </div>
    );
  return <StatusView id={latest.id} />;
}

function StatusView({ id }: { id: string }) {
  const application = useQuery(applicationQuery(id));
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const [confirming, setConfirming] = useState(false);
  if (application.isPending) return <div className="h-48 animate-pulse rounded bg-slate-200" />;
  if (application.isError)
    return <Alert tone="error">We couldn't load your application. Please try again.</Alert>;
  const a = application.data;

  const withdraw = () =>
    run(async () => {
      const withdrawn = await api<typeof applications.withdrawApplication>(
        "POST",
        "/applications/:id/withdraw",
        { params: { id } },
      );
      queryClient.setQueryData(applicationQuery(id).queryKey, withdrawn);
      await queryClient.invalidateQueries({ queryKey: ["applications", "mine"] });
      setConfirming(false);
    });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-title">Your application</h1>
        <p className="text-sm text-slate-600">
          {a.programme.name} · {a.studyMode === "ON_CAMPUS" ? "On campus" : "Online"} ·{" "}
          {a.intake.academicSessionName}
        </p>
      </div>

      <section className="space-y-2 rounded border border-slate-200 bg-white p-4">
        <p>
          Status: <strong>{STATUS_LABEL[a.status]}</strong>
        </p>
        {a.referenceNo === null ? null : (
          <p>
            Application Reference No: <strong>{a.referenceNo}</strong>
          </p>
        )}
        {a.status === "DRAFT" ? (
          <Link to="/application/edit" className="text-brand underline">
            Continue your application
          </Link>
        ) : null}
        {a.status === "ADMITTED" && a.offer !== null ? (
          <Offer
            applicationId={a.id}
            expiresAt={a.offer.expiresAt}
            programmeName={a.programme.name}
          />
        ) : null}
        {a.status === "ACCEPTED" && a.enrollment !== null ? (
          <div className="space-y-2">
            <p className="text-lg">
              Welcome to GLIM! Your Matric Number is <strong>{a.enrollment.matricNumber}</strong>.
            </p>
            <p className="text-sm text-slate-600">
              We've emailed you the next steps. Keep signing in with this Google account; your
              courses appear here when registration opens for your first semester.
            </p>
          </div>
        ) : null}
        {a.status === "LAPSED" ? (
          <p className="text-sm text-slate-600">
            Your offer lapsed because it wasn't accepted in time. If you'd still like to study with
            us, contact Admissions, who can reopen it.
          </p>
        ) : null}
        {a.status === "SUBMITTED" ? (
          <p className="text-sm text-slate-600">
            We've emailed you a receipt. We review applications as they arrive and will email you
            when there's a decision.
          </p>
        ) : null}
        {ENDED.includes(a.status) ? (
          <Link to="/application/edit" className="text-brand underline">
            Start a new application
          </Link>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">History</h3>
        <ol className="space-y-1 border-l-2 border-slate-200 pl-4 text-sm">
          {a.timeline.map((event) => (
            <li key={`${event.status}-${event.at}`}>
              <strong>{STATUS_LABEL[event.status]}</strong> · <Time value={event.at} />
            </li>
          ))}
        </ol>
      </section>

      {WITHDRAWABLE.includes(a.status) ? (
        <section className="space-y-2">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {confirming ? (
            <div className="space-y-2 rounded border border-red-200 bg-red-50 p-3 text-sm">
              <p>
                Withdraw your application? You can't undo this, though you may apply again while the
                intake is open.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void withdraw()}
                  className="rounded bg-red-700 px-3 py-1 font-medium text-white"
                >
                  Yes, withdraw
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                  }}
                  className="underline"
                >
                  Keep my application
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirming(true);
              }}
              className="text-sm text-red-700 underline"
            >
              Withdraw application
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** Days and hours left, e.g. "6 days, 3 hours"; under an hour, minutes. */
function remaining(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const plural = (n: number, unit: string) => `${String(n)} ${unit}${n === 1 ? "" : "s"}`;
  if (days > 0) return `${plural(days, "day")}, ${plural(hours, "hour")}`;
  if (hours > 0) return `${plural(hours, "hour")}, ${plural(minutes % 60, "minute")}`;
  return plural(minutes, "minute");
}

/** The offer with its countdown (spec stories 22, 24); accepting makes them a student at once. */
function Offer({
  applicationId,
  expiresAt,
  programmeName,
}: {
  applicationId: string;
  expiresAt: string;
  programmeName: string;
}) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const [now, setNow] = useState(() => Date.now());
  // One key per acceptance attempt, so a retried request can't enroll twice.
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const left = new Date(expiresAt).getTime() - now;

  return (
    <div className="space-y-3 rounded border border-green-200 bg-green-50 p-3">
      <p>
        Congratulations! You've been offered a place on the <strong>{programmeName}</strong>.
      </p>
      <p className="text-sm">
        Accept by <Time value={expiresAt} />{" "}
        {left > 0 ? <strong>({remaining(left)} left)</strong> : null}
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <button
        type="button"
        disabled={busy || left <= 0}
        onClick={() =>
          void run(async () => {
            const accepted = await api<typeof applications.acceptOffer>(
              "POST",
              "/applications/:id/accept",
              { params: { id: applicationId }, headers: { "idempotency-key": key.current } },
            );
            queryClient.setQueryData(applicationQuery(applicationId).queryKey, accepted);
            await queryClient.invalidateQueries({ queryKey: ["me"] });
          })
        }
        className="w-full rounded bg-brand px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        {busy ? "Accepting…" : "Accept offer"}
      </button>
    </div>
  );
}
