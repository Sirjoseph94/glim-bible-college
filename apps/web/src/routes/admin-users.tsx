import type { UserListItem, users } from "@glim/contracts";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { api } from "../api/client";
import { STAFF_ROLE_LABELS, type StaffRole } from "../api/users";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { formText } from "../components/form";
import { Badge, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/choice";
import { bodyCell, DataTable, headCell, stickyCell } from "../components/ui/data-table";
import { Sheet } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Select, TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";

const STATUSES = ["", "INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"] as const;

/** An account's status as a word (UI-3). */
export const USER_STATUS: Record<UserListItem["status"], { tone: Tone; word: string }> = {
  INVITED: { tone: "info", word: "Invited" },
  ACTIVE: { tone: "success", word: "Active" },
  SUSPENDED: { tone: "warning", word: "Suspended" },
  DEACTIVATED: { tone: "neutral", word: "Deactivated" },
};

/** The people with accounts (§11.11): search, filter by status, invite staff. */
export function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("");
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState<{ emailSent: boolean; text: string } | null>(null);
  const list = useInfiniteQuery({
    queryKey: ["users", "list", { q, status }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      api<typeof users.listUsers>("GET", "/users", {
        signal,
        query: { q, status, ...(pageParam === undefined ? {} : { cursor: pageParam }) },
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        meta="Staff and students with an account."
        actions={
          <Button
            variant="primary"
            icon="users"
            onClick={() => {
              setInviting(true);
            }}
          >
            Invite a staff member
          </Button>
        }
      />
      <InviteSheet
        open={inviting}
        onOpenChange={setInviting}
        onInvited={(result) => {
          setInvited(result);
          setInviting(false);
        }}
      />
      {invited ? (
        <Banner
          tone={invited.emailSent ? "success" : "warning"}
          onDismiss={() => {
            setInvited(null);
          }}
        >
          {invited.text}
        </Banner>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <TextField
            type="search"
            label="Search by name or email"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
          />
        </div>
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as (typeof STATUSES)[number]);
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "" ? "Any status" : USER_STATUS[s].word}
            </option>
          ))}
        </Select>
      </div>
      {list.isPending ? (
        <SkeletonGroup label="Loading users">
          <Skeleton className="h-48" />
        </SkeletonGroup>
      ) : list.isError ? (
        <LoadFailed what="the users" onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="users" title="No users match">
          Try another name, email or status.
        </EmptyState>
      ) : (
        <>
          <DataTable caption="Users" minWidth="min-w-160">
            <thead>
              <tr>
                <th scope="col" className={`${headCell} ${stickyCell}`}>
                  Name
                </th>
                <th scope="col" className={headCell}>
                  Email
                </th>
                <th scope="col" className={headCell}>
                  Status
                </th>
                <th scope="col" className={headCell}>
                  Roles
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td className={`${bodyCell} ${stickyCell}`}>
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: u.id }}
                      className="inline-flex min-h-tap items-center font-semibold text-brand underline"
                    >
                      {u.displayName}
                    </Link>
                  </td>
                  <td className={`${bodyCell} text-ink-muted`}>{u.email}</td>
                  <td className={bodyCell}>
                    <Badge tone={USER_STATUS[u.status].tone}>{USER_STATUS[u.status].word}</Badge>
                  </td>
                  <td className={bodyCell}>
                    {u.roles.length > 0 ? (
                      u.roles.map((r) => STAFF_ROLE_LABELS[r]).join(", ")
                    ) : (
                      <span className="text-ink-muted">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Show more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Invites a staff member by email, with the roles they start with. */
function InviteSheet({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: (result: { emailSent: boolean; text: string }) => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  const { busy, problem, fieldErrors, run } = useSubmit();

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a staff member"
      description="They get an email with a link to set their password."
      footer={
        <Button type="submit" form={formId} variant="primary" block loading={busy}>
          Send invite
        </Button>
      }
    >
      <form
        id={formId}
        className="space-y-4"
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
            form.reset();
            await queryClient.invalidateQueries({ queryKey: ["users"] });
            onInvited({
              emailSent: result.emailSent,
              text: result.emailSent
                ? `Invite emailed to ${result.user.email}.`
                : `${result.user.email} was created, but the email couldn't be sent. Use "Send a new invite" on their page.`,
            });
          });
        }}
      >
        {problem && Object.keys(fieldErrors).length === 0 ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        <TextField
          id="displayName"
          name="displayName"
          label="Full name"
          required
          error={fieldErrors.displayName}
        />
        <TextField
          id="invite-email"
          name="email"
          type="email"
          label="Email"
          required
          error={fieldErrors.email}
        />
        <fieldset>
          <legend className="text-label">Roles</legend>
          {(Object.entries(STAFF_ROLE_LABELS) as [StaffRole, string][]).map(([role, label]) => (
            <Checkbox key={role} name={`role-${role}`} label={label} />
          ))}
        </fieldset>
      </form>
    </Sheet>
  );
}
