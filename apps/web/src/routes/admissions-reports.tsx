import type { admissions, AdmissionsReport, reports } from "@glim/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { Alert } from "../components/form";

const download = (path: string, query: Record<string, string>) => {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== "")).toString();
  return `/api/v1${path}?${params}`;
};

function Counts({ title, counts }: { title: string; counts: AdmissionsReport["byStatus"] }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-3">
      <h3 className="mb-2 font-semibold">{title}</h3>
      {counts.length === 0 ? (
        <p className="text-sm text-slate-600">None yet.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {counts.map((c) => (
              <tr key={c.key}>
                <td>{c.label}</td>
                <td className="text-right tabular-nums">{c.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
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
    <div className="space-y-4">
      <h1 className="text-title">Admissions reports</h1>
      <select
        aria-label="Intake"
        value={intakeId}
        onChange={(e) => {
          setIntakeId(e.target.value);
        }}
        className="rounded border border-slate-300 bg-white px-2 py-2"
      >
        <option value="">All intakes</option>
        {intakes.data?.items.map((i) => (
          <option key={i.id} value={i.id}>
            Intake {i.code}
          </option>
        ))}
      </select>

      {report.isError ? <Alert tone="error">We couldn't load the report.</Alert> : null}
      {report.data ? (
        <>
          <p>
            <strong>{report.data.total}</strong> submitted applications ·{" "}
            {report.data.draftsInProgress} drafts in progress ·{" "}
            <a
              href={download("/reports/admissions", { intakeId, format: "csv" })}
              className="underline"
            >
              Download CSV
            </a>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Counts title="By status" counts={report.data.byStatus} />
            <Counts title="By programme" counts={report.data.byProgramme} />
            <Counts title="By study mode" counts={report.data.byStudyMode} />
            <Counts title="By country" counts={report.data.byCountry} />
            <Counts title="How they heard about us" counts={report.data.byHeardVia} />
          </div>
        </>
      ) : null}

      <section className="space-y-2 rounded border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">Referrals</h3>
          <a
            href={download("/reports/referrals", { intakeId, format: "csv" })}
            className="text-sm underline"
          >
            Download CSV
          </a>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th>Referrer</th>
              <th>Code</th>
              <th className="text-right">Applied</th>
              <th className="text-right">Admitted</th>
              <th className="text-right">Accepted</th>
            </tr>
          </thead>
          <tbody>
            {referrals.data?.referrers.map((r) => (
              <tr key={r.userId}>
                <td>{r.name}</td>
                <td className="font-mono">{r.code}</td>
                <td className="text-right tabular-nums">{r.total}</td>
                <td className="text-right tabular-nums">{r.admitted}</td>
                <td className="text-right tabular-nums">{r.accepted}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {referrals.data && referrals.data.unmatched.length > 0 ? (
          <p className="text-sm text-amber-700">
            Codes that matched nobody:{" "}
            {referrals.data.unmatched
              .map((u) => `${u.code} (${String(u.applications.length)})`)
              .join(", ")}
          </p>
        ) : null}
      </section>

      <section className="space-y-2 rounded border border-slate-200 bg-white p-3">
        <h3 className="font-semibold">Export applications</h3>
        <p className="text-sm text-slate-600">
          Every submitted application, one row each. Exports are audited.
        </p>
        <a
          href={download("/admissions/applications/export", { intakeId, format: "csv" })}
          className="mr-4 underline"
        >
          Download CSV
        </a>
        {confirmSensitive ? (
          <span className="text-sm">
            This includes confidential spiritual-background answers.{" "}
            <a
              href={download("/admissions/applications/export", {
                intakeId,
                includeSensitive: "true",
                format: "csv",
              })}
              className="font-medium text-red-700 underline"
            >
              Download with confidential answers
            </a>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirmSensitive(true);
            }}
            className="text-sm underline"
          >
            Include spiritual background…
          </button>
        )}
      </section>
    </div>
  );
}
