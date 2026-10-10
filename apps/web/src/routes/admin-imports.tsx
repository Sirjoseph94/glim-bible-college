import type { ImportJob, ImportKind, imports } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Alert } from "../components/form";
import { Time } from "../components/time";
import { uploadFile } from "../components/upload";
import { useSubmit } from "../components/use-submit";

// The web client imports only types from the contracts (no Zod in the bundle), so the kinds are
// listed here; the Record type keeps the list in step with the contract.
const KIND_LABELS: Record<ImportKind, string> = {
  STUDENTS: "Students (with Matric Numbers and programme enrollment)",
  LECTURERS: "Lecturers",
  COURSE_ENROLLMENTS: "Course enrollments",
  COURSE_RESULTS: "Past course results (count toward CGPA)",
};

const startImport = (kind: ImportKind, fileId: string, dryRun: boolean) =>
  api<typeof imports.startImport>("POST", "/imports", {
    body: { kind, fileId, dryRun },
    headers: { "idempotency-key": crypto.randomUUID() },
  });

/** Polls an import until it finishes. */
function useImport(id: string | null) {
  return useQuery({
    queryKey: ["imports", id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      api<typeof imports.getImport>("GET", "/imports/:id", { params: { id: id ?? "" }, signal }),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "COMPLETED" || status === "FAILED" ? false : 1500;
    },
  });
}

function Outcome({ job }: { job: ImportJob }) {
  if (job.status === "FAILED")
    return <Alert tone="error">The import failed: {job.stats.failure ?? "unknown error"}.</Alert>;
  if (job.status !== "COMPLETED")
    return (
      <p className="text-sm text-slate-600">
        {job.dryRun ? "Checking" : "Importing"}… {job.rowsDone} of {job.stats.total || "?"} rows
      </p>
    );
  const s = job.stats;
  return (
    <div className="space-y-1 text-sm">
      <p>
        {job.dryRun ? "Checked" : "Imported"} {s.total} rows: <strong>{s.valid} valid</strong>,{" "}
        {s.invalid} with errors. {job.dryRun ? "Would create" : "Created"} {s.created}, update{" "}
        {s.updated}, leave {s.unchanged} unchanged.
      </p>
      {job.errorFile ? (
        <a href={job.errorFile.downloadPath} className="text-brand underline">
          Download the rows with errors
        </a>
      ) : null}
    </div>
  );
}

/** CSV imports of existing GLIM data: dry run, then commit (TRD §15.2, D-04). */
export function AdminImportsPage() {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const [kind, setKind] = useState<ImportKind>("STUDENTS");
  const [fileId, setFileId] = useState<string | null>(null);
  const [checkId, setCheckId] = useState<string | null>(null);
  const [commitId, setCommitId] = useState<string | null>(null);
  const check = useImport(checkId);
  const commit = useImport(commitId);
  const recent = useQuery({
    queryKey: ["imports"],
    queryFn: ({ signal }) => api<typeof imports.listImports>("GET", "/imports", { signal }),
  });
  useEffect(() => {
    if (commit.data?.status === "COMPLETED")
      void queryClient.invalidateQueries({ queryKey: ["imports"] });
  }, [commit.data?.status, queryClient]);

  const reset = () => {
    setFileId(null);
    setCheckId(null);
    setCommitId(null);
  };

  return (
    <div className="space-y-5">
      <h1 className="text-title">Import data</h1>
      <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">What are you importing?</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ImportKind);
              reset();
            }}
            className="block w-full rounded border border-slate-300 bg-white px-2 py-2"
          >
            {(Object.keys(KIND_LABELS) as ImportKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <a href={`/api/v1/imports/templates/${kind}`} className="text-sm text-brand underline">
          Download the CSV template
        </a>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">CSV file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (file === undefined) return;
              reset();
              void run(async () => {
                const id = await uploadFile(file, {
                  name: file.name,
                  mime: file.type === "" ? "text/csv" : file.type,
                  purpose: "IMPORT",
                });
                setFileId(id);
                setCheckId((await startImport(kind, id, true)).id);
              });
            }}
          />
        </label>
        {check.data ? (
          <div className="space-y-2 rounded bg-slate-50 p-3">
            <h3 className="font-medium">Check (nothing has been changed yet)</h3>
            <Outcome job={check.data} />
            {check.data.status === "COMPLETED" &&
            check.data.stats.valid > 0 &&
            commitId === null ? (
              <button
                type="button"
                disabled={busy || fileId === null}
                className="rounded bg-brand px-4 py-2 font-medium text-white"
                onClick={() =>
                  void run(async () => {
                    setCommitId((await startImport(kind, fileId ?? "", false)).id);
                  })
                }
              >
                Import {check.data.stats.valid} valid rows
              </button>
            ) : null}
          </div>
        ) : null}
        {commit.data ? (
          <div className="space-y-2 rounded bg-green-50 p-3">
            <h3 className="font-medium">Import</h3>
            <Outcome job={commit.data} />
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Recent imports</h3>
        <ul className="space-y-1 text-sm">
          {recent.data?.items.map((job) => (
            <li key={job.id}>
              <Time value={job.createdAt} /> · {job.fileName} · {job.kind.toLowerCase()} ·{" "}
              {job.dryRun ? "check" : "import"} · {job.status.toLowerCase()} · {job.stats.valid}{" "}
              valid, {job.stats.invalid} errors
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
