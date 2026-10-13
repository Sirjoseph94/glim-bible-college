import type { admissions, AdmissionsReport, reports } from "@glim/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  DataTable,
  bodyCell,
  headCell,
  numericCell,
  stickyCell,
} from "../components/ui/data-table";
import { EmptyState } from "../components/ui/empty-state";
import { Select } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";

const download = (path: string, query: Record<string, string>) => {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== "")).toString();
  return `/api/v1${path}?${params}`;
};

function Counts({ title, counts }: { title: string; counts: AdmissionsReport["byStatus"] }) {
  return (
    <Card className="space-y-2">
      <h2 className="text-heading">{title}</h2>
      {counts.length === 0 ? (
        <p className="text-body-sm text-ink-muted">None yet.</p>
      ) : (
        <dl className="divide-y divide-line text-body-sm">
          {counts.map((c) => (
            <div key={c.key} className="flex justify-between gap-4 py-1.5">
              <dt>{c.label}</dt>
              <dd className="tabular-nums">{c.count}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

/** Intake and referral reports, and the application export (TRD §10.5–10.6; stories 37–38). */
export function AdmissionsReportsPage() {
  const [intakeId, setIntakeId] = useState("");
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const intakes = useQuery({
    queryKey: ["intakes"],
    queryFn: ({ signal }) => api<typeof admissions.listIntakes>("GET", "/intakes", { signal }),
  });
  const report = useQuery({
    queryKey: ["reports", "admissions", intakeId],
    queryFn: ({ signal }) =>
      api<typeof reports.getAdmissionsReport>("GET", "/reports/admissions", {
        signal,
        query: { intakeId },
      }),
  });
  const referrals = useQuery({
    queryKey: ["reports", "referrals", intakeId],
    queryFn: ({ signal }) =>
      api<typeof reports.getReferralReport>("GET", "/reports/referrals", {
        signal,
        query: { intakeId },
      }),
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Admissions reports" meta="Counts per intake, referrals and exports." />
      <div className="max-w-sm">
        <Select
          label="Intake"
          value={intakeId}
          onChange={(e) => {
            setIntakeId(e.target.value);
          }}
        >
          <option value="">All intakes</option>
          {intakes.data?.items.map((i) => (
            <option key={i.id} value={i.id}>
              Intake {i.code}
            </option>
          ))}
        </Select>
      </div>

      {report.isPending ? (
        <SkeletonGroup label="Loading the report">
          <Skeleton className="h-6 w-1/2" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </SkeletonGroup>
      ) : report.isError ? (
        <LoadFailed what="the report" onRetry={() => void report.refetch()} />
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-body">
              <strong>{report.data.total}</strong> submitted applications ·{" "}
              {report.data.draftsInProgress} drafts in progress
            </p>
            <Button asChild variant="secondary" size="sm" icon="download">
              <a href={download("/reports/admissions", { intakeId, format: "csv" })}>
                Download report (CSV)
              </a>
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Counts title="By status" counts={report.data.byStatus} />
            <Counts title="By programme" counts={report.data.byProgramme} />
            <Counts title="By study mode" counts={report.data.byStudyMode} />
            <Counts title="By country" counts={report.data.byCountry} />
            <Counts title="How they heard about us" counts={report.data.byHeardVia} />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-heading">Referrals</h2>
          <Button asChild variant="secondary" size="sm" icon="download">
            <a href={download("/reports/referrals", { intakeId, format: "csv" })}>
              Download referrals (CSV)
            </a>
          </Button>
        </div>
        {referrals.isPending ? (
          <SkeletonGroup label="Loading referrals">
            <Skeleton className="h-32" />
          </SkeletonGroup>
        ) : referrals.isError ? (
          <LoadFailed what="the referrals" onRetry={() => void referrals.refetch()} />
        ) : (
          <>
            {referrals.data.referrers.length === 0 ? (
              <Card>
                <EmptyState icon="users" title="No referrals yet" headingLevel={3}>
                  Applications that give a referral code are counted here.
                </EmptyState>
              </Card>
            ) : (
              <DataTable caption="Referrals" minWidth="min-w-160">
                <thead>
                  <tr>
                    <th scope="col" className={`${headCell} ${stickyCell}`}>
                      Referrer
                    </th>
                    <th scope="col" className={headCell}>
                      Code
                    </th>
                    <th scope="col" className={`${headCell} ${numericCell}`}>
                      Applied
                    </th>
                    <th scope="col" className={`${headCell} ${numericCell}`}>
                      Admitted
                    </th>
                    <th scope="col" className={`${headCell} ${numericCell}`}>
                      Accepted
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.data.referrers.map((r) => (
                    <tr key={r.userId}>
                      <td className={`${bodyCell} ${stickyCell}`}>{r.name}</td>
                      <td className={`${bodyCell} font-mono`}>{r.code}</td>
                      <td className={`${bodyCell} ${numericCell}`}>{r.total}</td>
                      <td className={`${bodyCell} ${numericCell}`}>{r.admitted}</td>
                      <td className={`${bodyCell} ${numericCell}`}>{r.accepted}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
            {referrals.data.unmatched.length > 0 ? (
              <Banner tone="warning" title="Codes that matched nobody">
                {referrals.data.unmatched
                  .map((u) => `${u.code} (${String(u.applications.length)})`)
                  .join(", ")}
              </Banner>
            ) : null}
          </>
        )}
      </section>

      <Card className="space-y-3">
        <h2 className="text-heading">Export applications</h2>
        <p className="text-body-sm text-ink-muted">
          Every submitted application, one row each. Exports are audited.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" icon="download">
            <a href={download("/admissions/applications/export", { intakeId, format: "csv" })}>
              Download applications (CSV)
            </a>
          </Button>
          {confirmSensitive ? null : (
            <Button
              variant="quiet"
              onClick={() => {
                setConfirmSensitive(true);
              }}
            >
              Include spiritual background…
            </Button>
          )}
        </div>
        {/* The confidential export takes a second, deliberate step (INV-15). */}
        {confirmSensitive ? (
          <Banner
            tone="warning"
            title="This includes confidential spiritual-background answers"
            action={
              <Button asChild variant="danger" size="sm" icon="download">
                <a
                  href={download("/admissions/applications/export", {
                    intakeId,
                    includeSensitive: "true",
                    format: "csv",
                  })}
                >
                  Download with confidential answers
                </a>
              </Button>
            }
          />
        ) : null}
      </Card>
    </div>
  );
}
