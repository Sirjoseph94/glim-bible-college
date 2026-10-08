import type { admissions } from "@glim/contracts";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { api } from "../api/client";
import { meQuery } from "../api/session";
import { Alert } from "../components/form";
import { GOOGLE_ERRORS, GoogleButton } from "../components/google";
import { CalendarDate } from "../components/time";

export const currentIntakeQuery = queryOptions({
  queryKey: ["intake", "current"],
  queryFn: ({ signal }) =>
    api<typeof admissions.getCurrentIntake>("GET", "/public/intakes/current", { signal }),
  staleTime: 10 * 60 * 1000,
});

const LENGTH: Record<string, string> = {
  CERTIFICATE: "1 year · Year 1",
  DIPLOMA: "2 years · Years 1 and 2",
};

/** The public landing page for applicants (TRD §10.2, spec stories 1, 3, 19). */
export function ApplyPage() {
  const current = useQuery(currentIntakeQuery);
  const me = useQuery(meQuery);
  const { error } = useSearch({ from: "/apply" });
  if (current.isPending) return <div className="h-48 animate-pulse rounded bg-slate-200" />;
  if (current.isError)
    return (
      <Alert tone="error">We couldn't load the admissions information. Please try again.</Alert>
    );
  const { intake, programmes, statementOfFaithUrl } = current.data;

  return (
    <div className="space-y-6">
      {error ? (
        <Alert tone="error">{GOOGLE_ERRORS[error] ?? GOOGLE_ERRORS.GOOGLE_SIGN_IN_FAILED}</Alert>
      ) : null}
      <section className="space-y-2">
        <h2 className="text-2xl font-semibold">Apply to study with us</h2>
        <p className="text-slate-700">
          Study theology on campus or online. Choose the programme that fits you.
        </p>
      </section>

      <ul className="grid gap-3 sm:grid-cols-2">
        {programmes.map((p) => (
          <li key={p.id} className="rounded border border-slate-200 bg-white p-4">
            <h3 className="font-semibold">{p.name}</h3>
            <p className="text-sm text-slate-600">
              {LENGTH[p.awardType] ?? `${String(p.levels)} year(s)`}
            </p>
          </li>
        ))}
      </ul>

      <section
        className="space-y-2 rounded border border-slate-200 bg-white p-4"
        aria-live="polite"
      >
        {intake === null ? (
          <p>There's no intake scheduled yet. Please check back soon.</p>
        ) : intake.status === "OPEN" ? (
          <p>
            Applications for the <strong>{intake.academicSessionName}</strong> are open until{" "}
            <strong>
              <CalendarDate value={intake.closesOn} />
            </strong>
            .
          </p>
        ) : intake.status === "PLANNED" ? (
          <p>
            Applications for the <strong>{intake.academicSessionName}</strong> open on{" "}
            <strong>
              <CalendarDate value={intake.opensOn} />
            </strong>
            .
          </p>
        ) : (
          <Alert tone="error">
            Applications for the {intake.academicSessionName} are closed. You can't start an
            application now.
          </Alert>
        )}
        {intake?.status === "OPEN" ? (
          me.data ? (
            <Link
              to="/application/edit"
              className="block w-full rounded bg-brand px-4 py-2 text-center font-medium text-white"
            >
              {me.data.roles.isApplicant ? "Continue your application" : "Start your application"}
            </Link>
          ) : (
            <GoogleButton
              href="/api/v1/auth/google/start?intent=apply&returnTo=%2Fapplication%2Fedit"
              label="Apply with Google"
            />
          )
        ) : null}
        <p className="text-sm text-slate-600">
          You apply with your Google account. No Google account?{" "}
          <a
            href="https://accounts.google.com/signup"
            className="text-brand underline"
            rel="noreferrer"
            target="_blank"
          >
            Create one free
          </a>
          .
        </p>
        {statementOfFaithUrl ? (
          <p className="text-sm text-slate-600">
            Applicants affirm our{" "}
            <a
              href={statementOfFaithUrl}
              className="text-brand underline"
              rel="noreferrer"
              target="_blank"
            >
              Statement of Faith
            </a>
            .
          </p>
        ) : null}
      </section>
    </div>
  );
}
