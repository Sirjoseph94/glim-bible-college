import type { admissions, CurrentIntake } from "@glim/contracts";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { api } from "../api/client";
import { meQuery } from "../api/session";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { GOOGLE_ERRORS, GoogleButton } from "../components/google";
import { CalendarDate } from "../components/time";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";

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

  return (
    <div className="space-y-6">
      {error ? (
        <Banner tone="danger">{GOOGLE_ERRORS[error] ?? GOOGLE_ERRORS.GOOGLE_SIGN_IN_FAILED}</Banner>
      ) : null}
      <PageHeader
        title="Apply to study with us"
        meta="Study theology on campus or online. Choose the programme that fits you."
      />
      {current.isPending ? (
        <SkeletonGroup label="Loading admissions information">
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <Skeleton className="h-40" />
        </SkeletonGroup>
      ) : current.isError ? (
        <LoadFailed what="the admissions information" onRetry={() => void current.refetch()} />
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {current.data.programmes.map((p) => (
              <li key={p.id}>
                <Card className="h-full space-y-1">
                  <h2 className="text-heading text-ink">{p.name}</h2>
                  <p className="text-body-sm text-ink-muted">
                    {LENGTH[p.awardType] ?? `${String(p.levels)} year(s)`}
                  </p>
                </Card>
              </li>
            ))}
          </ul>

          <IntakeCard
            intake={current.data.intake}
            statementOfFaithUrl={current.data.statementOfFaithUrl}
            signedIn={me.data ? { isApplicant: me.data.roles.isApplicant } : null}
          />
        </>
      )}
    </div>
  );
}

/** Whether applications are open, and the way in: Google sign-up, or straight to the form. */
function IntakeCard({
  intake,
  statementOfFaithUrl,
  signedIn,
}: {
  intake: CurrentIntake["intake"];
  statementOfFaithUrl: CurrentIntake["statementOfFaithUrl"];
  signedIn: { isApplicant: boolean } | null;
}) {
  return (
    <Card className="space-y-4">
      <div aria-live="polite">
        {intake === null ? (
          <p className="text-body">There's no intake scheduled yet. Please check back soon.</p>
        ) : intake.status === "OPEN" ? (
          <p className="text-body">
            Applications for the <strong>{intake.academicSessionName}</strong> are open until{" "}
            <strong>
              <CalendarDate value={intake.closesOn} />
            </strong>
            .
          </p>
        ) : intake.status === "PLANNED" ? (
          <p className="text-body">
            Applications for the <strong>{intake.academicSessionName}</strong> open on{" "}
            <strong>
              <CalendarDate value={intake.opensOn} />
            </strong>
            .
          </p>
        ) : (
          <Banner tone="warning">
            Applications for the {intake.academicSessionName} are closed. You can't start an
            application now.
          </Banner>
        )}
      </div>
      {intake?.status === "OPEN" ? (
        signedIn ? (
          <Button asChild variant="primary" block>
            <Link to="/application/edit">
              {signedIn.isApplicant ? "Continue your application" : "Start your application"}
            </Link>
          </Button>
        ) : (
          <GoogleButton
            href="/api/v1/auth/google/start?intent=apply&returnTo=%2Fapplication%2Fedit"
            label="Apply with Google"
          />
        )
      ) : null}
      <div className="space-y-1 text-body-sm text-ink-muted">
        <p>
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
          <p>
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
      </div>
    </Card>
  );
}
