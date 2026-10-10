import type { audit, AuditLogItem } from "@glim/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { Time } from "../components/time";
import { Badge, type Tone } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { bodyCell, DataTable, headCell } from "../components/ui/data-table";
import { EmptyState } from "../components/ui/empty-state";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";

const OUTCOME: Record<AuditLogItem["outcome"], { tone: Tone; word: string }> = {
  SUCCESS: { tone: "success", word: "Success" },
  DENIED: { tone: "warning", word: "Denied" },
  FAILURE: { tone: "danger", word: "Failure" },
};

/** The audit trail, newest first (§11.11), a page at a time with "Show more" (§9.19). */
export function AdminAuditPage() {
  const log = useInfiniteQuery({
    queryKey: ["audit", "list"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api<typeof audit.listAuditLogs>("GET", "/audit-logs", {
        signal,
        query: pageParam === undefined ? {} : { cursor: pageParam },
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Audit log" meta="Every change and denied attempt, newest first." />
      {log.isPending ? (
        <SkeletonGroup label="Loading the audit log">
          <Skeleton className="h-64" />
        </SkeletonGroup>
      ) : log.isError ? (
        <LoadFailed what="the audit log" onRetry={() => void log.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="file" title="Nothing is logged yet" />
      ) : (
        <>
          <DataTable caption="Audit log" minWidth="min-w-240">
            <thead>
              <tr>
                <th scope="col" className={headCell}>
                  When
                </th>
                <th scope="col" className={headCell}>
                  Action
                </th>
                <th scope="col" className={headCell}>
                  Outcome
                </th>
                <th scope="col" className={headCell}>
                  Resource
                </th>
                <th scope="col" className={headCell}>
                  By
                </th>
                <th scope="col" className={headCell}>
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className={`${bodyCell} text-ink-muted`}>
                    <Time value={entry.createdAt} />
                  </td>
                  <td className={`${bodyCell} font-mono text-code`}>{entry.action}</td>
                  <td className={bodyCell}>
                    <Badge tone={OUTCOME[entry.outcome].tone}>{OUTCOME[entry.outcome].word}</Badge>
                  </td>
                  <td className={bodyCell}>
                    {entry.resourceType}
                    {entry.resourceId === null ? null : (
                      <span className="block font-mono text-code text-ink-muted">
                        {entry.resourceId}
                      </span>
                    )}
                  </td>
                  <td className={`${bodyCell} font-mono text-code`}>
                    {entry.actorUserId ?? entry.actorType.toLowerCase()}
                  </td>
                  <td className={`${bodyCell} min-w-64 whitespace-normal`}>
                    {Object.keys(entry.metadata).length > 0 ? (
                      <pre className="rounded-sm bg-surface-sunken p-2 font-mono text-code break-all whitespace-pre-wrap">
                        {JSON.stringify(entry.metadata, null, 2)}
                      </pre>
                    ) : (
                      <span className="text-ink-muted">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {log.hasNextPage ? (
            <Button
              variant="secondary"
              loading={log.isFetchingNextPage}
              onClick={() => void log.fetchNextPage()}
            >
              Show more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
