import type { GoogleIntegration, HostAccount, ops } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { formText } from "../components/form";
import { LoadFailed } from "../components/app/page-states";
import { Time } from "../components/time";
import { Badge, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { bodyCell, DataTable, headCell } from "../components/ui/data-table";
import { TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";

const STATUS_TONE: Record<NonNullable<GoogleIntegration["status"]>, Tone> = {
  UNVERIFIED: "warning",
  VERIFIED: "success",
  DEGRADED: "danger",
  DISABLED: "neutral",
};

const STATUS_WORD: Record<NonNullable<GoogleIntegration["status"]>, string> = {
  UNVERIFIED: "Not tested",
  VERIFIED: "Working",
  DEGRADED: "Needs attention",
  DISABLED: "Off",
};

/** What `?youtube=` says after Google's consent round trip. */
const YOUTUBE_RETURN: Record<string, { tone: "success" | "warning" | "danger"; text: string }> = {
  connected: { tone: "success", text: "The YouTube channel is connected." },
  declined: { tone: "warning", text: "Google's consent was cancelled; nothing changed." },
  failed: { tone: "danger", text: "The channel couldn't be connected. Try again." },
  unavailable: {
    tone: "warning",
    text: "Automatic upload isn't switched on for this app (see the runbook).",
  },
};

function bytes(n: number): string {
  const gb = n / 1024 ** 3;
  return gb >= 1024 ? `${(gb / 1024).toFixed(1)} TB` : `${gb.toFixed(1)} GB`;
}

/**
 * The Google Meet and YouTube integrations (TRD §15.3, Appendix A; integration slice): the values
 * the Workspace admin pastes into the Admin Console, the host accounts, a background test, and
 * the YouTube channel connection. Nothing here calls Google directly: tests run in the worker.
 */
export function AdminIntegrationsPage() {
  const params = new URLSearchParams(window.location.search);
  const back = YOUTUBE_RETURN[params.get("youtube") ?? ""];
  return (
    <div className="space-y-8">
      <PageHeader
        title="Integrations"
        meta="Google Meet for live classes, and GLIM's YouTube channel for recordings."
      />
      {back ? (
        <Banner tone={back.tone} title={back.text}>
          {null}
        </Banner>
      ) : null}
      <GoogleSection />
      <YouTubeSection />
    </div>
  );
}

function GoogleSection() {
  const queryClient = useQueryClient();
  const google = useQuery({
    queryKey: ["integrations", "google"],
    queryFn: ({ signal }) =>
      api<typeof ops.getGoogleIntegration>("GET", "/admin/integrations/google", { signal }),
  });
  const test = useSubmit();
  const [queued, setQueued] = useState(false);
  if (google.isPending)
    return (
      <SkeletonGroup label="Loading Google Meet">
        <Skeleton className="h-60" />
      </SkeletonGroup>
    );
  if (google.isError)
    return <LoadFailed what="Google Meet" onRetry={() => void google.refetch()} />;
  const g = google.data;
  return (
    <section aria-labelledby="google" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="google" className="text-heading">
          Google Meet
        </h2>
        {g.mode === "none" ? (
          <Badge tone="neutral">Off: Lecturers paste Meet links</Badge>
        ) : g.status ? (
          <Badge tone={STATUS_TONE[g.status]}>{STATUS_WORD[g.status]}</Badge>
        ) : (
          <Badge tone="warning">Not tested</Badge>
        )}
      </div>
      {g.mode === "none" ? (
        <p className="text-body-sm text-ink">
          Class Meetings use links Lecturers paste. To have the app create the Meet, let students in
          without knocking and count online attendance, follow the Google runbook and set{" "}
          <code className="font-mono text-code">LIVE_PROVIDER=google_meet</code>.
        </p>
      ) : null}
      {g.lastError ? (
        <Banner tone="danger" title="Google needs attention">
          {g.lastError}
        </Banner>
      ) : null}

      <Card className="space-y-3 p-4">
        <h3 className="text-subhead">For the Admin Console</h3>
        <p className="text-body-sm text-ink-muted">
          Security → API controls → Domain-wide delegation: add this client ID with exactly these
          scopes.
        </p>
        {/* eslint-disable-next-line glim/design-tokens -- design-exception: geometry, label column width */}
        <dl className="grid gap-2 text-body-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-ink-muted">Client ID</dt>
          <dd className="font-mono text-code break-all">{g.serviceAccount?.clientId ?? "–"}</dd>
          <dt className="text-ink-muted">Service account</dt>
          <dd className="font-mono text-code break-all">{g.serviceAccount?.clientEmail ?? "–"}</dd>
          <dt className="text-ink-muted">Scopes</dt>
          <dd>
            {g.delegationScopes.length === 0 ? (
              "–"
            ) : (
              <ul className="space-y-1 font-mono text-code break-all">
                {g.delegationScopes.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
            )}
          </dd>
          <dt className="text-ink-muted">Pub/Sub topic</dt>
          <dd className="font-mono text-code break-all">{g.pubsubTopic ?? "–"}</dd>
          <dt className="text-ink-muted">Pull subscription</dt>
          <dd className="font-mono text-code break-all">{g.pubsubSubscription ?? "–"}</dd>
        </dl>
      </Card>

      <DomainForm primaryDomain={g.primaryDomain} />
      <HostAccounts hosts={g.hostAccounts} />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            loading={test.busy}
            disabled={g.mode === "none"}
            onClick={() => {
              void test.run(async () => {
                await api<typeof ops.testGoogleIntegration>(
                  "POST",
                  "/admin/integrations/google/test",
                );
                setQueued(true);
                setTimeout(() => {
                  void queryClient.invalidateQueries({ queryKey: ["integrations", "google"] });
                }, 5000);
              });
            }}
          >
            Test Google
          </Button>
          <span role="status" className="text-body-sm text-ink-muted">
            {queued ? "Testing in the background; this page updates in a moment." : null}
          </span>
        </div>
        {test.problem ? (
          <p role="alert" className="text-body-sm text-danger">
            {test.problem.title}
          </p>
        ) : null}
        {g.lastCheck ? <LastCheck check={g.lastCheck} /> : null}
      </div>
    </section>
  );
}

function DomainForm({ primaryDomain }: { primaryDomain: string | null }) {
  const queryClient = useQueryClient();
  const save = useSubmit();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        const value = formText(new FormData(event.currentTarget), "primaryDomain").trim();
        void save.run(async () => {
          await api<typeof ops.saveGoogleIntegration>("POST", "/admin/integrations/google", {
            body: { primaryDomain: value === "" ? null : value },
          });
          await queryClient.invalidateQueries({ queryKey: ["integrations", "google"] });
        });
      }}
    >
      <div className="min-w-60 flex-1">
        <TextField
          label="Workspace domain"
          name="primaryDomain"
          hint="Host accounts must be on it, e.g. glim.edu.ng."
          defaultValue={primaryDomain ?? ""}
          error={save.fieldErrors["body.primaryDomain"]}
        />
      </div>
      <Button type="submit" loading={save.busy}>
        Save
      </Button>
    </form>
  );
}

function HostAccounts({ hosts }: { hosts: HostAccount[] }) {
  const queryClient = useQueryClient();
  const add = useSubmit();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["integrations", "google"] });
  return (
    <div className="space-y-3">
      <h3 className="text-subhead">Host accounts</h3>
      <p className="text-body-sm text-ink-muted">
        The Workspace accounts that own the Meet spaces (two are enough). Their Google user ID, from
        the Admin Console's user page, lets the app receive Meet's events.
      </p>
      {hosts.length > 0 ? (
        <DataTable caption="Host accounts" minWidth="min-w-180">
          <thead>
            <tr>
              <th scope="col" className={headCell}>
                Account
              </th>
              <th scope="col" className={headCell}>
                Google user ID
              </th>
              <th scope="col" className={headCell}>
                Events
              </th>
              <th scope="col" className={headCell}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {hosts.map((h) => (
              <HostRow key={h.id} host={h} onChanged={refresh} />
            ))}
          </tbody>
        </DataTable>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const userId = formText(data, "providerUserId").trim();
          void add.run(async () => {
            await api<typeof ops.addHostAccount>(
              "POST",
              "/admin/integrations/google/host-accounts",
              {
                body: {
                  email: formText(data, "email").trim(),
                  providerUserId: userId === "" ? null : userId,
                },
              },
            );
            form.reset();
            await refresh();
          });
        }}
      >
        <div className="min-w-60 flex-1">
          <TextField
            label="Add a host account"
            name="email"
            type="email"
            required
            placeholder="lms-host-01@glim.edu.ng"
            error={add.fieldErrors["body.email"]}
          />
        </div>
        <div className="min-w-40">
          <TextField
            label="Google user ID"
            name="providerUserId"
            optional
            inputMode="numeric"
            error={add.fieldErrors["body.providerUserId"]}
          />
        </div>
        <Button type="submit" loading={add.busy}>
          Add
        </Button>
      </form>
      {add.problem && Object.keys(add.fieldErrors).length === 0 ? (
        <p role="alert" className="text-body-sm text-danger">
          {add.problem.title}
        </p>
      ) : null}
    </div>
  );
}

function HostRow({ host, onChanged }: { host: HostAccount; onChanged: () => Promise<void> }) {
  const change = useSubmit();
  const [userId, setUserId] = useState(host.providerUserId ?? "");
  const patch = (body: { providerUserId?: string | null; status?: "ACTIVE" | "DISABLED" }) =>
    change.run(async () => {
      await api<typeof ops.updateHostAccount>(
        "PATCH",
        "/admin/integrations/google/host-accounts/:id",
        { params: { id: host.id }, body },
      );
      await onChanged();
    });
  const off = host.status !== "ACTIVE";
  return (
    <tr aria-label={host.email} className="align-top">
      <td className={`${bodyCell} whitespace-normal`}>
        {host.email}
        <span className="block text-meta text-ink-muted">
          {off ? "Not used" : "In use"}
          {host.circuit === "OPEN" ? " · paused after repeated failures" : ""}
        </span>
      </td>
      <td className={bodyCell}>
        <form
          className="flex gap-2"
          onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
            event.preventDefault();
            void patch({ providerUserId: userId.trim() === "" ? null : userId.trim() });
          }}
        >
          <input
            aria-label={`Google user ID for ${host.email}`}
            value={userId}
            inputMode="numeric"
            onChange={(event) => {
              setUserId(event.target.value);
            }}
            className="h-9 w-40 rounded-sm border border-line bg-surface px-2 font-mono text-code"
          />
          <Button type="submit" size="sm" loading={change.busy}>
            Save
          </Button>
        </form>
        {change.problem ? (
          <p role="alert" className="text-body-sm text-danger">
            {change.problem.title}
          </p>
        ) : null}
      </td>
      <td className={`${bodyCell} whitespace-normal`}>
        {host.subscription === null ? (
          <span className="text-ink-muted">Not subscribed</span>
        ) : (
          <>
            <Badge tone={host.subscription.status === "ACTIVE" ? "success" : "danger"}>
              {host.subscription.status === "ACTIVE" ? "Receiving" : "Not receiving"}
            </Badge>
            {host.subscription.expiresAt ? (
              <span className="block text-meta text-ink-muted">
                Renews before <Time value={host.subscription.expiresAt} />
              </span>
            ) : null}
          </>
        )}
      </td>
      <td className={bodyCell}>
        <Button
          size="sm"
          variant={off ? "secondary" : "quiet"}
          onClick={() => void patch({ status: off ? "ACTIVE" : "DISABLED" })}
        >
          {off ? "Use again" : "Stop using"}
        </Button>
      </td>
    </tr>
  );
}

function LastCheck({ check }: { check: NonNullable<GoogleIntegration["lastCheck"]> }) {
  return (
    <Card className="space-y-3 p-4">
      <p className="text-body-sm">
        Last test <Time value={check.checkedAt} />:{" "}
        <strong>{check.ok ? "everything worked." : "something needs fixing."}</strong>
      </p>
      {check.detail ? <p className="text-body-sm text-danger">{check.detail}</p> : null}
      <ul className="space-y-2">
        {check.hosts.map((h) => {
          const missing = h.permissions.filter((p) => !p.granted);
          return (
            <li key={h.email} className="text-body-sm">
              <span className="font-semibold">{h.email}</span>:{" "}
              {h.ok ? "OK" : (h.detail ?? "failed")}
              {h.storage && h.storage.limitBytes !== null ? (
                <span className="text-ink-muted">
                  {" "}
                  · Drive {bytes(h.storage.usedBytes)} of {bytes(h.storage.limitBytes)}
                </span>
              ) : null}
              {missing.length > 0 ? (
                <ul className="mt-1 font-mono text-code text-danger">
                  {missing.map((p) => (
                    <li key={p.permission}>Missing: {p.permission}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function YouTubeSection() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["ops", "youtube"],
    queryFn: ({ signal }) =>
      api<typeof ops.getYouTubeStatus>("GET", "/admin/integrations/youtube/status", { signal }),
  });
  const disconnect = useSubmit();
  if (status.isPending) return <Skeleton className="h-32" />;
  if (status.isError)
    return <LoadFailed what="the YouTube channel" onRetry={() => void status.refetch()} />;
  const { channel } = status.data;
  return (
    <section aria-labelledby="youtube" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="youtube" className="text-heading">
          YouTube channel
        </h2>
        {channel.connected && channel.status ? (
          <Badge tone={STATUS_TONE[channel.status]}>{STATUS_WORD[channel.status]}</Badge>
        ) : (
          <Badge tone="neutral">Not connected</Badge>
        )}
      </div>
      {!channel.uploadsEnabled ? (
        <p className="text-body-sm text-ink">
          Recordings are uploaded by hand in YouTube Studio and their links pasted in. Automatic
          upload needs <code className="font-mono text-code">VIDEO_HOST=youtube_api</code> and
          Google's YouTube API audit (see the runbook).
        </p>
      ) : channel.connected && channel.channel ? (
        <>
          <p className="text-body-sm text-ink">
            Recordings of Class Meetings are uploaded, unlisted, to{" "}
            <a href={channel.channel.url} className="font-semibold underline" rel="noreferrer">
              {channel.channel.title}
            </a>
            .
          </p>
          {channel.lastError ? (
            <Banner tone="danger" title="YouTube refused the app">
              {channel.lastError} Connect the channel again.
            </Banner>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/v1/admin/integrations/youtube/connect"
              className={buttonClass({ variant: "secondary" })}
            >
              Connect again
            </a>
            <Button
              variant="danger"
              loading={disconnect.busy}
              onClick={() => {
                void disconnect.run(async () => {
                  await api<typeof ops.disconnectYouTube>(
                    "POST",
                    "/admin/integrations/youtube/disconnect",
                  );
                  await queryClient.invalidateQueries({ queryKey: ["ops", "youtube"] });
                });
              }}
            >
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-body-sm text-ink">
            Sign in with an owner or manager of GLIM's YouTube channel to let the app upload Meet
            recordings to it.
          </p>
          <a
            href="/api/v1/admin/integrations/youtube/connect"
            className={buttonClass({ variant: "primary" })}
          >
            Connect the channel
          </a>
        </>
      )}
    </section>
  );
}
