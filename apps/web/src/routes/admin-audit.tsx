import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { auditQuery } from "../api/users";
import { Alert } from "../components/form";
import { Time } from "../components/time";

export function AdminAuditPage() {
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const log = useQuery(auditQuery(cursor === undefined ? {} : { cursor }));

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Audit log</h2>
      {log.isPending ? (
        <div className="h-40 animate-pulse rounded bg-slate-200" />
      ) : log.isError ? (
        <Alert tone="error">{log.error.message}</Alert>
      ) : (
        <>
          <ol className="divide-y divide-slate-200 rounded border border-slate-200 bg-white text-sm">
            {log.data.items.map((entry) => (
              <li key={entry.id} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{entry.action}</span>
                  <span className="text-slate-500">
                    <Time value={entry.createdAt} />
                  </span>
                </div>
                <div className="text-slate-600">
                  {entry.outcome.toLowerCase()} · {entry.resourceType} {entry.resourceId ?? ""} · by{" "}
                  {entry.actorUserId ?? entry.actorType.toLowerCase()}
                </div>
                {Object.keys(entry.metadata).length > 0 ? (
                  <pre
                    tabIndex={0}
                    className="overflow-x-auto rounded bg-slate-50 p-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="flex gap-3">
            {cursors.length > 0 ? (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setCursors(cursors.slice(0, -1));
                }}
              >
                Newer
              </button>
            ) : null}
            {log.data.nextCursor !== null ? (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  if (log.data.nextCursor !== null) setCursors([...cursors, log.data.nextCursor]);
                }}
              >
                Older
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
