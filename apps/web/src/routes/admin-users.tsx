import type { users } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { STAFF_ROLE_LABELS, usersQuery, type StaffRole } from "../api/users";
import { Alert, Field, formText, SubmitButton } from "../components/form";
import { useSubmit } from "../components/use-submit";

const STATUSES = ["", "INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"] as const;

export function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("");
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const list = useQuery(usersQuery({ q, status, ...(cursor === undefined ? {} : { cursor }) }));

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Users</h2>
      <InviteForm />
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Search by name or email"
          placeholder="Search name or email"
          className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursors([]);
          }}
        />
        <select
          aria-label="Status"
          className="rounded border border-slate-300 px-2 py-2"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as (typeof STATUSES)[number]);
            setCursors([]);
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "" ? "Any status" : s.toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      {list.isPending ? (
        <div className="h-24 animate-pulse rounded bg-slate-200" />
      ) : list.isError ? (
        <Alert tone="error">{list.error.message}</Alert>
      ) : (
        <>
          <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
            {list.data.items.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <Link
                  to="/admin/users/$userId"
                  params={{ userId: u.id }}
                  className="font-medium text-brand underline"
                >
                  {u.displayName}
                </Link>
                <span className="text-sm text-slate-600">{u.email}</span>
                <span className="text-xs text-slate-500">
                  {u.status.toLowerCase()}
                  {u.roles.length > 0
                    ? ` · ${u.roles.map((r) => STAFF_ROLE_LABELS[r]).join(", ")}`
                    : ""}
                </span>
              </li>
            ))}
            {list.data.items.length === 0 ? (
              <li className="px-3 py-2 text-slate-500">No users match.</li>
            ) : null}
          </ul>
          <div className="flex gap-2">
            {cursors.length > 0 ? (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setCursors(cursors.slice(0, -1));
                }}
              >
                Previous
              </button>
            ) : null}
            {list.data.nextCursor !== null ? (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  if (list.data.nextCursor !== null) setCursors([...cursors, list.data.nextCursor]);
                }}
              >
                Next
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function InviteForm() {
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  const [done, setDone] = useState<string | null>(null);

  return (
    <details className="rounded border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-medium">Invite a staff member</summary>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const roles = (Object.keys(STAFF_ROLE_LABELS) as StaffRole[]).filter(
            (r) => data.get(`role-${r}`) === "on",
          );
          void run(async () => {
            const result = await api<typeof users.inviteUser>("POST", "/users", {
              body: {
                email: formText(data, "email"),
                displayName: formText(data, "displayName"),
                roles,
              },
            });
            setDone(
              result.emailSent
                ? `Invite emailed to ${result.user.email}.`
                : `${result.user.email} was created, but the email couldn't be sent. Use "Send a new invite" on their page.`,
            );
            form.reset();
            await queryClient.invalidateQueries({ queryKey: ["users"] });
          });
        }}
      >
        {done ? <Alert tone="success">{done}</Alert> : null}
        {error && Object.keys(fieldErrors).length === 0 ? (
          <Alert tone="error">{error}</Alert>
        ) : null}
        <Field
          id="displayName"
          name="displayName"
          label="Full name"
          required
          error={fieldErrors.displayName}
        />
        <Field
          id="invite-email"
          name="email"
          type="email"
          label="Email"
          required
          error={fieldErrors.email}
        />
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-slate-700">Roles</legend>
          {(Object.entries(STAFF_ROLE_LABELS) as [StaffRole, string][]).map(([role, label]) => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`role-${role}`} /> {label}
            </label>
          ))}
        </fieldset>
        <SubmitButton busy={busy}>Send invite</SubmitButton>
      </form>
    </details>
  );
}
