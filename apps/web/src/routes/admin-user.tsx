import type { privacy, users } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { api } from "../api/client";
import { STAFF_ROLE_LABELS, userQuery, type StaffRole } from "../api/users";
import { PageHeader } from "../components/app/page-header";
import { isNotAvailable, LoadFailed, NotAvailable } from "../components/app/page-states";
import { formText } from "../components/form";
import { Time } from "../components/time";
import { Badge } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/dialog";
import { Select, TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";
import { USER_STATUS } from "./admin-users";

/** The API's minimum for a reason on role and account changes. */
const REASON_MIN = 3;

/** A change waiting on the ConfirmDialog: what it does, and the call that makes it. */
interface PendingChange {
  title: string;
  consequence: ReactNode;
  confirmLabel: string;
  tone: "primary" | "danger";
  reasonLabel: string;
  /** The API's minimum: 3 for role and account changes, 1 for erasure. */
  reasonMin?: number;
  action: (reason: string) => Promise<unknown>;
}

/**
 * One person's account (§11.11): their staff roles, their name, and the account's status.
 * Every role or status change asks for a reason, kept in the audit log.
 */
export function AdminUserPage() {
  const { userId } = useParams({ from: "/admin/users/$userId" });
  const user = useQuery(userQuery(userId));
  const queryClient = useQueryClient();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);

  if (user.isPending)
    return (
      <SkeletonGroup label="Loading the account">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40" />
      </SkeletonGroup>
    );
  if (user.isError)
    return isNotAvailable(user.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="this account" onRetry={() => void user.refetch()} />
    );
  const u = user.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["user", userId] });
  const ifMatch = { "if-match": `"${String(u.version)}"` };
  const grantable = (Object.entries(STAFF_ROLE_LABELS) as [StaffRole, string][]).filter(
    ([role]) => !u.roles.some((r) => r.role === role),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={u.displayName}
        meta={
          <>
            {u.email} · last signed in <Time value={u.lastLoginAt} />
          </>
        }
        actions={<Badge tone={USER_STATUS[u.status].tone}>{USER_STATUS[u.status].word}</Badge>}
      />
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      {notice ? (
        <Banner
          tone={notice.ok ? "success" : "warning"}
          onDismiss={() => {
            setNotice(null);
          }}
        >
          {notice.text}
        </Banner>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-heading">Roles</h2>
        <Card list role="list">
          {u.roles.map((r) => (
            <div
              key={r.id}
              role="listitem"
              aria-label={STAFF_ROLE_LABELS[r.role]}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <p className="min-w-0 text-subhead">
                {STAFF_ROLE_LABELS[r.role]}{" "}
                <span className="text-meta text-ink-muted">
                  since <Time value={r.grantedAt} withDate />
                </span>
              </p>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setPending({
                    title: `Remove ${STAFF_ROLE_LABELS[r.role]}?`,
                    consequence: `${u.displayName} loses everything the ${STAFF_ROLE_LABELS[r.role]} role lets them do, straight away.`,
                    confirmLabel: "Remove role",
                    tone: "danger",
                    reasonLabel: "Why remove this role?",
                    action: (reason) =>
                      api<typeof users.revokeRole>("DELETE", "/users/:id/roles/:assignmentId", {
                        params: { id: u.id, assignmentId: r.id },
                        body: { reason },
                      }),
                  });
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          {u.roles.length === 0 ? (
            <p className="px-4 py-3 text-body-sm text-ink-muted">No staff roles.</p>
          ) : null}
        </Card>
        {u.status !== "DEACTIVATED" && grantable.length > 0 ? (
          <form
            className="flex flex-col gap-3 md:flex-row md:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              const role = formText(new FormData(event.currentTarget), "role") as StaffRole;
              setPending({
                title: `Grant ${STAFF_ROLE_LABELS[role]}?`,
                consequence: `${u.displayName} can do everything a ${STAFF_ROLE_LABELS[role]} can, straight away.`,
                confirmLabel: `Grant ${STAFF_ROLE_LABELS[role]}`,
                tone: "primary",
                reasonLabel: "Why grant this role?",
                action: (reason) =>
                  api<typeof users.assignRole>("POST", "/users/:id/roles", {
                    params: { id: u.id },
                    body: { role, reason },
                  }),
              });
            }}
          >
            <div className="min-w-0 flex-1">
              <Select name="role" label="Role to grant">
                {grantable.map(([role, label]) => (
                  <option key={role} value={role}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary">
              Grant role
            </Button>
          </form>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-heading">Account</h2>
        <Card className="space-y-5">
          <form
            className="space-y-4"
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
            <TextField
              id="displayName"
              name="displayName"
              label="Full name"
              defaultValue={u.displayName}
              required
              error={fieldErrors.displayName}
            />
            <Button type="submit" variant="primary" loading={busy}>
              Save name
            </Button>
          </form>
          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
            {u.status === "INVITED" ? (
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => {
                  void run(async () => {
                    const r = await api<typeof users.resendInvite>("POST", "/users/:id/invite", {
                      params: { id: u.id },
                    });
                    setNotice(
                      r.emailSent
                        ? { ok: true, text: "A new invite was emailed." }
                        : { ok: false, text: "The email couldn't be sent. Try again later." },
                    );
                  });
                }}
              >
                Send a new invite
              </Button>
            ) : null}
            {u.status === "ACTIVE" ? (
              <Button
                variant="danger"
                onClick={() => {
                  setPending({
                    title: "Suspend this account?",
                    consequence: `${u.displayName} is signed out and can't sign in until the account is reactivated.`,
                    confirmLabel: "Suspend account",
                    tone: "danger",
                    reasonLabel: "Why suspend this account?",
                    action: (reason) =>
                      api<typeof users.updateUser>("PATCH", "/users/:id", {
                        params: { id: u.id },
                        headers: ifMatch,
                        body: { status: "SUSPENDED", reason },
                      }),
                  });
                }}
              >
                Suspend
              </Button>
            ) : null}
            {u.status === "SUSPENDED" ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setPending({
                    title: "Reactivate this account?",
                    consequence: `${u.displayName} can sign in again, with the roles they hold.`,
                    confirmLabel: "Reactivate account",
                    tone: "primary",
                    reasonLabel: "Why reactivate this account?",
                    action: (reason) =>
                      api<typeof users.updateUser>("PATCH", "/users/:id", {
                        params: { id: u.id },
                        headers: ifMatch,
                        body: { status: "ACTIVE", reason },
                      }),
                  });
                }}
              >
                Reactivate
              </Button>
            ) : null}
            {u.status !== "DEACTIVATED" ? (
              <Button
                variant="danger"
                onClick={() => {
                  setPending({
                    title: "Deactivate this account?",
                    consequence: `Deactivation is permanent: ${u.displayName} can never sign in with this account again.`,
                    confirmLabel: "Deactivate account",
                    tone: "danger",
                    reasonLabel: "Why deactivate this account?",
                    action: (reason) =>
                      api<typeof users.deactivateUser>("POST", "/users/:id/deactivate", {
                        params: { id: u.id },
                        body: { reason },
                      }),
                  });
                }}
              >
                Deactivate
              </Button>
            ) : null}
            {!u.email.endsWith("@erased.invalid") ? (
              <Button
                variant="danger"
                onClick={() => {
                  setPending({
                    title: "Erase this person's personal data?",
                    consequence:
                      "Erasing removes this person's personal details for good. Their academic record stays, under a pseudonym. This can't be undone.",
                    confirmLabel: "Erase personal data",
                    tone: "danger",
                    reasonLabel: "Why erase them?",
                    reasonMin: 1,
                    action: (reason) =>
                      api<typeof privacy.eraseUser>("POST", "/users/:id/erase", {
                        params: { id: u.id },
                        body: { reason },
                      }),
                  });
                }}
              >
                Erase personal data
              </Button>
            ) : null}
          </div>
        </Card>
      </section>

      <ConfirmDialog
        // A fresh dialog per change, so one change's reason never carries over to the next.
        key={pending?.title ?? "none"}
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={pending?.title ?? ""}
        confirmLabel={pending?.confirmLabel ?? ""}
        tone={pending?.tone ?? "primary"}
        reason={{
          label: pending?.reasonLabel ?? "Reason",
          minLength: pending?.reasonMin ?? REASON_MIN,
        }}
        onConfirm={async (reason) => {
          if (pending === null) return;
          // A failure throws, and the dialog stays open saying what happened.
          await pending.action(reason);
          setPending(null);
          await refresh();
        }}
      >
        {pending?.consequence}
      </ConfirmDialog>
    </div>
  );
}
