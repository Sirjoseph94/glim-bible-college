import type { PolicyView, Settings, settings } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { Alert, Field, formText, SubmitButton } from "../components/form";
import { Time } from "../components/time";
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

export function AdminSettingsPage() {
  const current = useQuery(settingsQuery);
  const policies = useQuery(policiesQuery);
  return (
    <div className="space-y-6">
      <h1 className="text-title">Settings</h1>
      {current.data ? (
        <SettingsForm current={current.data} />
      ) : (
        <div className="h-40 animate-pulse rounded bg-slate-200" />
      )}
      <h2 className="text-heading">Policies</h2>
      {policies.data?.items.map((policy) => (
        <PolicyForm key={`${policy.type}-${String(policy.version)}`} policy={policy} />
      )) ?? <div className="h-40 animate-pulse rounded bg-slate-200" />}
    </div>
  );
}

function SettingsForm({ current }: { current: Settings }) {
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-4 rounded border border-slate-200 bg-white p-4"
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
      {saved ? <Alert tone="success">Settings saved.</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        id="name"
        name="name"
        label="Institution name"
        defaultValue={current.name}
        required
        error={fieldErrors.name}
      />
      <Field
        id="timezone"
        name="timezone"
        label="Institution timezone"
        defaultValue={current.timezone}
        required
        error={fieldErrors.timezone}
      />
      <Textarea
        id="staffEmailDomains"
        label="Staff Google Workspace domains (one per line; empty allows any)"
        defaultValue={current.staffEmailDomains.join("\n")}
        error={Object.entries(fieldErrors).find(([k]) => k.startsWith("staffEmailDomains"))?.[1]}
      />
      <Field
        id="statementOfFaithUrl"
        name="statementOfFaithUrl"
        type="url"
        label="Statement of Faith link"
        defaultValue={current.statementOfFaithUrl ?? ""}
        error={fieldErrors.statementOfFaithUrl}
      />
      <Textarea
        id="youtubeChannelUrls"
        label="GLIM YouTube channel URLs (one per line)"
        defaultValue={current.youtubeChannelUrls.join("\n")}
        error={Object.entries(fieldErrors).find(([k]) => k.startsWith("youtubeChannelUrls"))?.[1]}
      />
      <p className="text-xs text-slate-500">
        Version {current.version}, last changed <Time value={current.updatedAt} />
      </p>
      <SubmitButton busy={busy}>Save settings</SubmitButton>
    </form>
  );
}

function Textarea({
  id,
  label,
  defaultValue,
  error,
}: {
  id: string;
  label: string;
  defaultValue: string;
  error?: string | undefined;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <textarea
        id={id}
        name={id}
        defaultValue={defaultValue}
        rows={3}
        className="block w-full rounded border border-slate-300 px-3 py-2"
      />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

/** A form generated from the policy's current values: numbers, switches, texts, and JSON for the rest. */
function PolicyForm({ policy }: { policy: PolicyView }) {
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  const entries = Object.entries(policy.config);

  return (
    <details className="rounded border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-medium">
        {POLICY_TITLES[policy.type] ?? policy.type}{" "}
        <span className="text-sm font-normal text-slate-500">
          {policy.version === 0 ? "· defaults" : `· version ${String(policy.version)}`}
        </span>
      </summary>
      <form
        className="mt-4 space-y-3"
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
        {error ? <Alert tone="error">{error}</Alert> : null}
        {entries.map(([key, value]) => {
          const id = `${policy.type}-${key}`;
          const fieldError = Object.entries(fieldErrors).find(([k]) =>
            k.startsWith(`config.${key}`),
          )?.[1];
          if (typeof value === "boolean") {
            return (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={key} defaultChecked={value} /> {labelFor(key)}
              </label>
            );
          }
          if (typeof value === "number") {
            return (
              <Field
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
          return (
            <div key={key} className="space-y-1">
              <label htmlFor={id} className="block text-sm font-medium text-slate-700">
                {labelFor(key)}
              </label>
              <textarea
                id={id}
                name={key}
                rows={typeof value === "string" && value.length > 80 ? 4 : 1}
                defaultValue={typeof value === "string" ? value : JSON.stringify(value)}
                className="block w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
              {fieldError ? <p className="text-sm text-red-700">{fieldError}</p> : null}
            </div>
          );
        })}
        <SubmitButton busy={busy}>Save a new version</SubmitButton>
      </form>
    </details>
  );
}
