import type { ImportJob, ImportKind, imports } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { Time } from "../components/time";
import { Badge, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
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
import { uploadFile } from "../components/upload";
import { useSubmit } from "../components/use-submit";
import { Icon } from "../design/icons";

// The web client imports only types from the contracts (no Zod in the bundle), so the kinds are
// listed here; the Record type keeps the list in step with the contract.
const KIND_LABELS: Record<ImportKind, string> = {
  STUDENTS: "Students (with Matric Numbers and programme enrollment)",
  LECTURERS: "Lecturers",
  COURSE_ENROLLMENTS: "Course enrollments",
  COURSE_RESULTS: "Past course results (count toward CGPA)",
};

/** Short names for the recent-imports table. */
const KIND_SHORT: Record<ImportKind, string> = {
  STUDENTS: "Students",
  LECTURERS: "Lecturers",
  COURSE_ENROLLMENTS: "Course enrollments",
  COURSE_RESULTS: "Past course results",
};

const JOB_STATUS: Record<ImportJob["status"], { tone: Tone; word: string }> = {
  QUEUED: { tone: "neutral", word: "Waiting" },
  RUNNING: { tone: "info", word: "Running" },
  COMPLETED: { tone: "success", word: "Done" },
  FAILED: { tone: "danger", word: "Failed" },
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
    return (
      <Banner tone="danger" title="The import failed">
        {job.stats.failure ?? "unknown error"}.
      </Banner>
    );
  if (job.status !== "COMPLETED")
    return (
      <p role="status" className="text-body-sm text-ink-muted">
        {job.dryRun ? "Checking" : "Importing"}… {job.rowsDone} of {job.stats.total || "?"} rows
      </p>
    );
  const s = job.stats;
  return (
    <div className="space-y-3">
      <p className="text-body">
        {job.dryRun ? "Checked" : "Imported"} {s.total} rows: <strong>{s.valid} valid</strong>,{" "}
        {s.invalid} with errors. {job.dryRun ? "Would create" : "Created"} {s.created}, update{" "}
        {s.updated}, leave {s.unchanged} unchanged.
      </p>
      {job.errorFile ? (
        <a
          href={job.errorFile.downloadPath}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          <Icon name="download" size={16} />
          Download the rows with errors
        </a>
      ) : null}
    </div>
  );
}

/** CSV imports of existing GLIM data: dry run, then commit (TRD §15.2, D-04). */
export function AdminImportsPage() {
  const queryClient = useQueryClient();
  const fileFieldId = useId();
  const { busy, problem, run } = useSubmit();
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
    <div className="space-y-8">
      <PageHeader
        title="Import data"
        meta="Check a CSV file first; nothing changes until you import the valid rows."
      />
      <Card className="space-y-4">
        <Select
          label="What are you importing?"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as ImportKind);
            reset();
          }}
        >
          {(Object.keys(KIND_LABELS) as ImportKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <a
          href={`/api/v1/imports/templates/${kind}`}
          className={buttonClass({ variant: "quiet", size: "sm" })}
        >
          <Icon name="download" size={16} />
          Download the CSV template
        </a>
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        <div className="space-y-1">
          <label htmlFor={fileFieldId} className="block text-label text-ink">
            CSV file
          </label>
          <input
            id={fileFieldId}
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            className={
              "block w-full text-body-sm text-ink-muted file:mr-3 file:min-h-tap file:rounded-md " +
              "file:border file:border-line-strong file:bg-surface-raised file:px-4 " +
              "file:text-body-sm file:font-semibold file:text-ink"
            }
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
        </div>
        {check.data ? (
          <section className="space-y-3 rounded-md bg-surface-sunken p-4">
            <h2 className="text-subhead">Check (nothing has been changed yet)</h2>
            <Outcome job={check.data} />
            {check.data.status === "COMPLETED" &&
            check.data.stats.valid > 0 &&
            commitId === null ? (
              <Button
                variant="primary"
                icon="upload"
                loading={busy}
                disabled={fileId === null}
                onClick={() =>
                  void run(async () => {
                    setCommitId((await startImport(kind, fileId ?? "", false)).id);
                  })
                }
              >
                Import {check.data.stats.valid} valid rows
              </Button>
            ) : null}
          </section>
        ) : null}
        {commit.data ? (
          <section className="space-y-3 rounded-md bg-success-soft p-4">
            <h2 className="text-subhead">Import</h2>
            <Outcome job={commit.data} />
          </section>
        ) : null}
      </Card>

      <section className="space-y-3">
        <h2 className="text-heading">Recent imports</h2>
        {recent.isPending ? (
          <SkeletonGroup label="Loading recent imports">
            <Skeleton className="h-32" />
          </SkeletonGroup>
        ) : recent.isError ? (
          <LoadFailed what="the recent imports" onRetry={() => void recent.refetch()} />
        ) : recent.data.items.length === 0 ? (
          <EmptyState icon="upload" title="No imports yet">
            Checks and imports you run appear here.
          </EmptyState>
        ) : (
          <DataTable caption="Recent imports" minWidth="min-w-180">
            <thead>
              <tr>
                <th scope="col" className={`${headCell} ${stickyCell}`}>
                  File
                </th>
                <th scope="col" className={headCell}>
                  Started
                </th>
                <th scope="col" className={headCell}>
                  Kind
                </th>
                <th scope="col" className={headCell}>
                  Run
                </th>
                <th scope="col" className={headCell}>
                  Status
                </th>
                <th scope="col" className={`${headCell} ${numericCell}`}>
                  Valid
                </th>
                <th scope="col" className={`${headCell} ${numericCell}`}>
                  Errors
                </th>
              </tr>
            </thead>
            <tbody>
              {recent.data.items.map((job) => (
                <tr key={job.id}>
                  <td className={`${bodyCell} ${stickyCell}`}>{job.fileName}</td>
                  <td className={bodyCell}>
                    <Time value={job.createdAt} />
                  </td>
                  <td className={bodyCell}>{KIND_SHORT[job.kind]}</td>
                  <td className={bodyCell}>{job.dryRun ? "Check" : "Import"}</td>
                  <td className={bodyCell}>
                    <Badge tone={JOB_STATUS[job.status].tone}>{JOB_STATUS[job.status].word}</Badge>
                  </td>
                  <td className={`${bodyCell} ${numericCell}`}>{job.stats.valid}</td>
                  <td className={`${bodyCell} ${numericCell}`}>{job.stats.invalid}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    </div>
  );
}
