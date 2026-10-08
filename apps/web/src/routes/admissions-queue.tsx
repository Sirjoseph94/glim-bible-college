import type { academic, admissions, ApplicationQueueItem } from "@glim/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { STATUS_LABEL } from "../api/applications";
import { api } from "../api/client";
import { Alert } from "../components/form";
import { Time } from "../components/time";

const FILTER_STATUSES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "ADMITTED",
  "ACCEPTED",
  "REJECTED",
  "LAPSED",
  "WITHDRAWN",
] as const;

const select =
  "rounded border border-slate-300 bg-white px-2 py-2 text-base focus:border-brand focus:outline-none";

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">Applications</h2>
        <div className="flex gap-4 text-sm">
          <Link to="/admissions/reports" className="underline">
            Reports
          </Link>
          <Link to="/admissions/intakes" className="underline">
            Intakes
          </Link>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <input
          type="search"
          aria-label="Search by name or reference"
          placeholder="Name or reference"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
          className={select}
        />
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
          }}
          className={select}
        >
          <option value="">Any status</option>
          {FILTER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Programme"
          value={programmeId}
          onChange={(e) => {
            setProgrammeId(e.target.value);
          }}
          className={select}
        >
          <option value="">Any programme</option>
          {programmes.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Study mode"
          value={studyMode}
          onChange={(e) => {
            setStudyMode(e.target.value);
          }}
          className={select}
        >
          <option value="">Any study mode</option>
          <option value="ON_CAMPUS">On campus</option>
          <option value="ONLINE">Online</option>
        </select>
      </div>

      {queue.isError ? <Alert tone="error">We couldn't load the applications.</Alert> : null}
      {queue.isPending ? <div className="h-32 animate-pulse rounded bg-slate-200" /> : null}
      {queue.isSuccess && items.length === 0 ? (
        <p className="text-slate-600">No applications match.</p>
      ) : null}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                to="/admissions/applications/$applicationId"
                params={{ applicationId: item.id }}
                className="font-medium text-brand underline"
              >
                {item.name}
              </Link>
              <span className="text-sm">{STATUS_LABEL[item.status]}</span>
            </div>
            <p className="text-sm text-slate-600">
              {item.referenceNo} · {item.programme.name} ·{" "}
              {item.studyMode === "ON_CAMPUS" ? "On campus" : "Online"} · submitted{" "}
              <Time value={item.submittedAt} />
            </p>
            {item.unmatchedReferral ? (
              <p className="text-sm text-amber-700">Referral code not recognised</p>
            ) : null}
          </li>
        ))}
      </ul>
      {queue.hasNextPage ? (
        <button
          type="button"
          disabled={queue.isFetchingNextPage}
          onClick={() => void queue.fetchNextPage()}
          className="rounded border border-slate-300 bg-white px-4 py-2"
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
