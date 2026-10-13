import type { academic, admissions, ApplicationQueueItem } from "@glim/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { STATUS_LABEL } from "../api/applications";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { Time } from "../components/time";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { DataTable, bodyCell, headCell, stickyCell } from "../components/ui/data-table";
import { EmptyState } from "../components/ui/empty-state";
import { Select, TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { ApplicationStatusBadge } from "./application";

const FILTER_STATUSES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "ADMITTED",
  "ACCEPTED",
  "REJECTED",
  "LAPSED",
  "WITHDRAWN",
] as const;

/** The officers' queue (TRD §10.3; spec story 29): oldest submissions first. */
export function AdmissionsQueuePage() {
  const [status, setStatus] = useState("");
  const [programmeId, setProgrammeId] = useState("");
  const [studyMode, setStudyMode] = useState("");
  const [q, setQ] = useState("");
  const filter = { status, programmeId, studyMode, q: q.trim() };

  const programmes = useQuery({
    queryKey: ["programmes"],
    queryFn: ({ signal }) => api<typeof academic.listProgrammes>("GET", "/programmes", { signal }),
  });
  const queue = useInfiniteQuery({
    queryKey: ["admissions", "queue", filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api<typeof admissions.listApplications>("GET", "/admissions/applications", {
        signal,
        query: { ...filter, cursor: pageParam },
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items: ApplicationQueueItem[] = queue.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Applications" meta="Submitted applications, oldest first." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          type="search"
          label="Search by name or reference"
          placeholder="Name or reference"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
          }}
        >
          <option value="">Any status</option>
          {FILTER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select
          label="Programme"
          value={programmeId}
          onChange={(e) => {
            setProgrammeId(e.target.value);
          }}
        >
          <option value="">Any programme</option>
          {programmes.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          label="Study mode"
          value={studyMode}
          onChange={(e) => {
            setStudyMode(e.target.value);
          }}
        >
          <option value="">Any study mode</option>
          <option value="ON_CAMPUS">On campus</option>
          <option value="ONLINE">Online</option>
        </Select>
      </div>

      {queue.isPending ? (
        <SkeletonGroup label="Loading applications">
          <Skeleton className="h-40" />
        </SkeletonGroup>
      ) : queue.isError ? (
        <LoadFailed what="the applications" onRetry={() => void queue.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon="users" title="No applications match">
            Try another status, programme or study mode, or clear the search.
          </EmptyState>
        </Card>
      ) : (
        <DataTable caption="Applications" minWidth="min-w-205">
          <thead>
            <tr>
              <th scope="col" className={`${headCell} ${stickyCell}`}>
                Applicant
              </th>
              <th scope="col" className={headCell}>
                Reference
              </th>
              <th scope="col" className={headCell}>
                Programme
              </th>
              <th scope="col" className={headCell}>
                Study mode
              </th>
              <th scope="col" className={headCell}>
                Submitted
              </th>
              <th scope="col" className={headCell}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className={`${bodyCell} ${stickyCell}`}>
                  <Link
                    to="/admissions/applications/$applicationId"
                    params={{ applicationId: item.id }}
                    className="inline-flex min-h-tap items-center text-brand underline"
                  >
                    {item.name}
                  </Link>
                </td>
                <td className={`${bodyCell} font-mono`}>{item.referenceNo}</td>
                <td className={bodyCell}>{item.programme.name}</td>
                <td className={bodyCell}>
                  {item.studyMode === "ON_CAMPUS" ? "On campus" : "Online"}
                </td>
                <td className={bodyCell}>
                  <Time value={item.submittedAt} />
                </td>
                <td className={bodyCell}>
                  <div className="flex flex-wrap gap-1">
                    <ApplicationStatusBadge status={item.status} />
                    {item.unmatchedReferral ? (
                      <Badge tone="warning">Referral code not recognised</Badge>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {queue.hasNextPage ? (
        <Button
          variant="secondary"
          loading={queue.isFetchingNextPage}
          onClick={() => void queue.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}
