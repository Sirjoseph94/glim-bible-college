import type { PolicyView, Settings, settings } from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { formText } from "../components/form";
import { Time } from "../components/time";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/choice";
import { Disclosure } from "../components/ui/disclosure";
import { TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";

const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: ({ signal }) => api<typeof settings.getSettings>("GET", "/settings", { signal }),
});

const policiesQuery = queryOptions({
  queryKey: ["policies"],
  queryFn: ({ signal }) => api<typeof settings.listPolicies>("GET", "/policies", { signal }),
});

const POLICY_TITLES: Record<string, string> = {
  ATTENDANCE: "Attendance",
  JOIN_WINDOW: "Joining Class Meetings",
  RECORDING: "Recordings",
  NOTIFICATION: "Notifications",
  ADMISSIONS: "Admissions",
  GRADING_DEFAULTS: "Grading defaults",
};

/** "presentThresholdBp" → "Present threshold (bp)". */
function labelFor(key: string): string {
  const words = key
    .replace(/Bp$/, " (bp)")
    .replace(/X100$/, " (×100)")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

/** The college's settings (§11.11), grouped, then each policy as its own versioned form. */
export function AdminSettingsPage() {
  const current = useQuery(settingsQuery);
  const policies = useQuery(policiesQuery);
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" meta="How GLIM runs: its name, sign-in, links and policies." />
      {current.isPending ? (
        <SkeletonGroup label="Loading the settings">
          <Skeleton className="h-64" />
        </SkeletonGroup>
      ) : current.isError ? (
        <LoadFailed what="the settings" onRetry={() => void current.refetch()} />
      ) : (
        <SettingsForm current={current.data} />
      )}
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-heading">Policies</h2>
          <p className="text-body-sm text-ink-muted">
            Saving a policy keeps the old one as an earlier version.
          </p>
        </div>
        {policies.isPending ? (
          <SkeletonGroup label="Loading the policies">
            <Skeleton className="h-48" />
          </SkeletonGroup>
        ) : policies.isError ? (
          <LoadFailed what="the policies" onRetry={() => void policies.refetch()} />
        ) : (
          <Card list>
            {policies.data.items.map((policy) => (
              <PolicyForm key={`${policy.type}-${String(policy.version)}`} policy={policy} />
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

/** A titled group of fields inside the settings form. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-subhead">{title}</legend>
      {children}
    </fieldset>
  );
}

function SettingsForm({ current }: { current: Settings }) {
  const queryClient = useQueryClient();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [saved, setSaved] = useState(false);
  const errorFor = (prefix: string) =>
    Object.entries(fieldErrors).find(([k]) => k.startsWith(prefix))?.[1];
  return (
    <Card>
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setSaved(false);
          void run(async () => {
            const result = await api<typeof settings.updateSettings>("PATCH", "/settings", {
              headers: { "if-match": `"${String(current.version)}"` },
              body: {
                name: formText(data, "name"),
                timezone: formText(data, "timezone"),
                staffEmailDomains: lines(formText(data, "staffEmailDomains")),
                statementOfFaithUrl: formText(data, "statementOfFaithUrl") || null,
                youtubeChannelUrls: lines(formText(data, "youtubeChannelUrls")),
              },
            });
            queryClient.setQueryData(settingsQuery.queryKey, result);
            await queryClient.invalidateQueries({ queryKey: ["institution"] });
            setSaved(true);
          });
        }}
      >
        {saved ? <Banner tone="success">Settings saved.</Banner> : null}
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        <Group title="Institution">
          {/* Stays editable (decision UI-Q13). */}
          <TextField
            id="name"
            name="name"
            label="Institution name"
            defaultValue={current.name}
            required
            error={fieldErrors.name}
          />
          <TextField
            id="timezone"
            name="timezone"
            label="Institution timezone"
            hint="An IANA name, like Africa/Lagos."
            defaultValue={current.timezone}
            required
            error={fieldErrors.timezone}
          />
        </Group>
        <Group title="Staff sign-in">
          <TextField
            multiline
            id="staffEmailDomains"
            name="staffEmailDomains"
            label="Staff Google Workspace domains"
            hint="One per line. Leave empty to allow any."
            rows={3}
            defaultValue={current.staffEmailDomains.join("\n")}
            error={errorFor("staffEmailDomains")}
          />
        </Group>
        <Group title="Links">
          <TextField
            id="statementOfFaithUrl"
            name="statementOfFaithUrl"
            type="url"
            label="Statement of Faith link"
            optional
            defaultValue={current.statementOfFaithUrl ?? ""}
            error={fieldErrors.statementOfFaithUrl}
          />
          <TextField
            multiline
            id="youtubeChannelUrls"
            name="youtubeChannelUrls"
            label="GLIM YouTube channel URLs"
            hint="One per line."
            rows={3}
            defaultValue={current.youtubeChannelUrls.join("\n")}
            error={errorFor("youtubeChannelUrls")}
          />
        </Group>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-meta text-ink-muted">
            Version {current.version}, last changed <Time value={current.updatedAt} />
          </p>
          <Button type="submit" variant="primary" loading={busy}>
            Save settings
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** A form generated from the policy's current values: numbers, switches, texts, and JSON for the rest. */
function PolicyForm({ policy }: { policy: PolicyView }) {
  const queryClient = useQueryClient();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const entries = Object.entries(policy.config);

  return (
    <div className="px-4">
      <Disclosure
        summary={
          <>
            {POLICY_TITLES[policy.type] ?? policy.type}{" "}
            <span className="text-meta text-ink-muted">
              {policy.version === 0 ? "· defaults" : `· version ${String(policy.version)}`}
            </span>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const config: Record<string, unknown> = {};
            for (const [key, value] of entries) {
              const raw = formText(data, key);
              if (typeof value === "number") config[key] = Number(raw);
              else if (typeof value === "boolean") config[key] = data.get(key) === "on";
              else if (typeof value === "string") config[key] = raw;
              else {
                try {
                  config[key] = JSON.parse(raw) as unknown;
                } catch {
                  config[key] = raw;
                }
              }
            }
            void run(async () => {
              await api<typeof settings.putPolicy>("PUT", "/policies/:type", {
                params: { type: policy.type },
                headers: { "if-match": `"${String(policy.version)}"` },
                body: { config },
              });
              await queryClient.invalidateQueries({ queryKey: ["policies"] });
            });
          }}
        >
          {problem ? (
            <Banner tone="danger" title={problem.title}>
              {problem.body}
            </Banner>
          ) : null}
          {entries.map(([key, value]) => {
            const id = `${policy.type}-${key}`;
            const fieldError = Object.entries(fieldErrors).find(([k]) =>
              k.startsWith(`config.${key}`),
            )?.[1];
            if (typeof value === "boolean") {
              return <Checkbox key={key} name={key} defaultChecked={value} label={labelFor(key)} />;
            }
            if (typeof value === "number") {
              return (
                <TextField
                  key={key}
                  id={id}
                  name={key}
                  type="number"
                  label={labelFor(key)}
                  defaultValue={value}
                  error={fieldError}
                />
              );
            }
            if (typeof value === "string" && value.length <= 80) {
              return (
                <TextField
                  key={key}
                  id={id}
                  name={key}
                  label={labelFor(key)}
                  defaultValue={value}
                  error={fieldError}
                />
              );
            }
            return (
              <TextField
                key={key}
                multiline
                id={id}
                name={key}
                label={labelFor(key)}
                hint={typeof value === "string" ? undefined : "JSON."}
                rows={4}
                defaultValue={typeof value === "string" ? value : JSON.stringify(value)}
                className={typeof value === "string" ? undefined : "font-mono text-code"}
                error={fieldError}
              />
            );
          })}
          <Button type="submit" variant="primary" loading={busy}>
            Save a new version
          </Button>
        </form>
      </Disclosure>
    </div>
  );
}
