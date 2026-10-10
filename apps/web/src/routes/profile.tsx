import type { privacy } from "@glim/contracts";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useSearch } from "@tanstack/react-router";
import { institutionQuery } from "../api/institution";
import { meQuery, updateMe } from "../api/session";
import { Alert, formText, SubmitButton } from "../components/form";
import { Time } from "../components/time";
import { useSubmit } from "../components/use-submit";
import { GOOGLE_ERRORS, GoogleButton } from "../components/google";

export function ProfilePage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: institution } = useSuspenseQuery(institutionQuery);
  const search = useSearch({ from: "/profile" });
  if (me === null) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Your profile</h2>
      {search.linked === "google" ? (
        <Alert tone="success">Your Google account is now linked.</Alert>
      ) : null}
      {search.error ? (
        <Alert tone="error">{GOOGLE_ERRORS[search.error] ?? "Something went wrong."}</Alert>
      ) : null}
      {/* eslint-disable-next-line glim/design-tokens -- design-exception: geometry, label column width */}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 rounded border border-slate-200 bg-white p-4">
        <dt className="text-slate-600">Name</dt>
        <dd>{me.user.displayName}</dd>
        <dt className="text-slate-600">Email</dt>
        <dd>{me.user.email}</dd>
        {me.user.referralCode === null ? null : (
          <>
            <dt className="text-slate-600">Referral code</dt>
            <dd>
              <strong className="font-mono tracking-wider">{me.user.referralCode}</strong>
              <p className="text-sm text-slate-600">
                Share it with people you encourage to apply, so the college knows who referred them.
              </p>
            </dd>
          </>
        )}
      </dl>
      <TimezoneForm current={me.user.timezone} />
      <DataExport />
      <section className="space-y-2 rounded border border-slate-200 bg-white p-4">
        <h3 className="font-semibold">Google account</h3>
        {me.user.googleLinked ? (
          <p className="text-slate-700">
            A Google account is linked. You can use it to sign in and to join online classes.
          </p>
        ) : institution.googleSignIn ? (
          <>
            <p className="text-slate-700">
              Link a Google account to sign in with it and to join online classes.
            </p>
            <GoogleButton
              href="/api/v1/auth/google/start?intent=link&returnTo=/profile"
              label="Link Google account"
            />
          </>
        ) : (
          <p className="text-slate-700">Linking a Google account isn't available yet.</p>
        )}
      </section>
    </div>
  );
}

/** All IANA zones the browser knows, for the picker. */
function knownZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["Africa/Lagos", "Europe/London", "America/New_York"];
  }
}

function TimezoneForm({ current }: { current: string }) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  return (
    <form
      className="space-y-2 rounded border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const timezone = formText(new FormData(event.currentTarget), "timezone");
        void run(() => updateMe(queryClient, { timezone }));
      }}
    >
      <label htmlFor="timezone" className="block font-semibold">
        Your timezone
      </label>
      <p className="text-sm text-slate-600">
        Times are shown in this zone, with Lagos time alongside when it differs. Right now it's{" "}
        <Time value={new Date().toISOString()} withDate={false} />.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <input
        id="timezone"
        name="timezone"
        list="timezones"
        defaultValue={current}
        className="block w-full rounded border border-slate-300 px-3 py-2"
        required
      />
      <datalist id="timezones">
        {knownZones().map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <SubmitButton busy={busy}>Save timezone</SubmitButton>
    </form>
  );
}

/** Data subject access (TRD §19.4): everything GLIM holds about you, as a JSON file. */
function DataExport() {
  const { busy, error, run } = useSubmit();
  return (
    <section className="space-y-2 rounded border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">Your data</h3>
      <p className="text-sm text-slate-600">
        Download everything the college holds about you, as a file you can keep.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <button
        type="button"
        disabled={busy}
        className="rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
        onClick={() => {
          void run(async () => {
            const data = await api<typeof privacy.getDataExport>("GET", "/me/data-export", {});
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "glim-my-data.json";
            link.click();
            URL.revokeObjectURL(url);
          });
        }}
      >
        {busy ? "Preparing…" : "Download my data"}
      </button>
    </section>
  );
}
