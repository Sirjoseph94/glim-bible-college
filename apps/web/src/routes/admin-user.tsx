import type { users } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../api/client";
import { STAFF_ROLE_LABELS, userQuery, type StaffRole } from "../api/users";
import { Alert, Field, formText, SubmitButton } from "../components/form";
import { Time } from "../components/time";
import { useSubmit } from "../components/use-submit";

export function AdminUserPage() {
  const { userId } = useParams({ from: "/admin/users/$userId" });
  const user = useQuery(userQuery(userId));
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const [notice, setNotice] = useState<string | null>(null);

  if (user.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (user.isError) return <Alert tone="error">{user.error.message}</Alert>;
  const u = user.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["user", userId] });
  const ifMatch = { "if-match": `"${String(u.version)}"` };

  /** Asks for a reason, then runs the change. */
  function withReason(prompt: string, action: (reason: string) => Promise<unknown>) {
    const reason = window.prompt(prompt);
    if (reason === null || reason.trim().length < 3) return;
    void run(async () => {
      await action(reason.trim());
      await refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{u.displayName}</h2>
        <p className="text-slate-600">
          {u.email} · {u.status.toLowerCase()} · last signed in <Time value={u.lastLoginAt} />
        </p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <section className="space-y-2 rounded border border-slate-200 bg-white p-4">
        <h3 className="font-semibold">Roles</h3>
        <ul className="space-y-1">
          {u.roles.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2">
              <span>
                {STAFF_ROLE_LABELS[r.role]}{" "}
                <span className="text-xs text-slate-500">
                  since <Time value={r.grantedAt} withDate />
                </span>
              </span>
              <button
                type="button"
                className="text-sm text-red-700 underline"
                disabled={busy}
                onClick={() => {
                  withReason(`Why remove ${STAFF_ROLE_LABELS[r.role]}?`, (reason) =>
                    api<typeof users.revokeRole>("DELETE", "/users/:id/roles/:assignmentId", {
                      params: { id: u.id, assignmentId: r.id },
                      body: { reason },
                    }),
                  );
                }}
              >
                Remove
              </button>
            </li>
          ))}
          {u.roles.length === 0 ? <li className="text-slate-500">No staff roles.</li> : null}
        </ul>
        {u.status !== "DEACTIVATED" ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const role = formText(new FormData(event.currentTarget), "role") as StaffRole;
              withReason(`Why grant ${STAFF_ROLE_LABELS[role]}?`, (reason) =>
                api<typeof users.assignRole>("POST", "/users/:id/roles", {
                  params: { id: u.id },
                  body: { role, reason },
                }),
              );
            }}
          >
            <select
              name="role"
              aria-label="Role to grant"
              className="rounded border border-slate-300 px-2 py-2"
            >
              {(Object.entries(STAFF_ROLE_LABELS) as [StaffRole, string][])
                .filter(([role]) => !u.roles.some((r) => r.role === role))
                .map(([role, label]) => (
                  <option key={role} value={role}>
                    {label}
                  </option>
                ))}
            </select>
            <button type="submit" className="rounded bg-brand px-3 py-2 text-white" disabled={busy}>
              Grant role
            </button>
          </form>
        ) : null}
      </section>

      <section className="space-y-4 rounded border border-slate-200 bg-white p-4">
        <h3 className="font-semibold">Account</h3>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const displayName = formText(new FormData(event.currentTarget), "displayName");
            void run(async () => {
              await api<typeof users.updateUser>("PATCH", "/users/:id", {
                params: { id: u.id },
                headers: ifMatch,
                body: { displayName },
              });
              await refresh();
            });
          }}
        >
          <Field
            id="displayName"
            name="displayName"
            label="Full name"
            defaultValue={u.displayName}
            required
          />
          <SubmitButton busy={busy}>Save name</SubmitButton>
        </form>
        <div className="flex flex-wrap gap-3">
          {u.status === "INVITED" ? (
            <button
              type="button"
              className="underline"
              onClick={() => {
                void run(async () => {
                  const r = await api<typeof users.resendInvite>("POST", "/users/:id/invite", {
                    params: { id: u.id },
                  });
                  setNotice(
                    r.emailSent
                      ? "A new invite was emailed."
                      : "The email couldn't be sent. Try again later.",
                  );
                });
              }}
            >
              Send a new invite
            </button>
          ) : null}
          {u.status === "ACTIVE" || u.status === "SUSPENDED" ? (
            <button
              type="button"
              className="underline"
              onClick={() => {
                const status = u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
                withReason(
                  status === "SUSPENDED"
                    ? "Why suspend this account?"
                    : "Why reactivate this account?",
                  (reason) =>
                    api<typeof users.updateUser>("PATCH", "/users/:id", {
                      params: { id: u.id },
                      headers: ifMatch,
                      body: { status, reason },
                    }),
                );
              }}
            >
              {u.status === "ACTIVE" ? "Suspend" : "Reactivate"}
            </button>
          ) : null}
          {u.status !== "DEACTIVATED" ? (
            <button
              type="button"
              className="text-red-700 underline"
              onClick={() => {
                withReason("Deactivation is permanent. Why deactivate this account?", (reason) =>
                  api<typeof users.deactivateUser>("POST", "/users/:id/deactivate", {
                    params: { id: u.id },
                    body: { reason },
                  }),
                );
              }}
            >
              Deactivate
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
