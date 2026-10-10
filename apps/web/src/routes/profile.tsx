import type { privacy } from "@glim/contracts";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { api } from "../api/client";
import { institutionQuery } from "../api/institution";
import { meQuery, signOut, updateMe } from "../api/session";
import { PageHeader } from "../components/app/page-header";
import { chooseView, homeView, useStoredView, type HomeView } from "../components/app/view";
import { formText } from "../components/form";
import { GOOGLE_ERRORS, GoogleButton } from "../components/google";
import { Time } from "../components/time";
import { useSubmit } from "../components/use-submit";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Radio } from "../components/ui/choice";
import { TextField } from "../components/ui/field";
import { useTheme, type ThemePreference } from "../design/theme";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <section aria-label={title} className="space-y-3">
        <h2 className="text-heading">{title}</h2>
        {children}
      </section>
    </Card>
  );
}

/**
 * The person's profile (docs/ui-design-handoff.md §11.11, composed): their account, which Home
 * they see when they are both a student and a Lecturer (§6.3), the theme, Google, their
 * timezone, notifications, their data, and signing out.
 */
export function ProfilePage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: institution } = useSuspenseQuery(institutionQuery);
  const search = useSearch({ from: "/profile" });
  if (me === null) return null;
  const bothRoles = me.roles.isStudent && me.roles.isLecturer;

  return (
    <div className="space-y-5">
      <PageHeader title="Profile" meta={`${me.user.displayName} · ${me.user.email}`} />
      {search.linked === "google" ? (
        <Banner tone="success">Your Google account is now linked.</Banner>
      ) : null}
      {search.error ? (
        <Banner tone="danger">{GOOGLE_ERRORS[search.error] ?? "Something went wrong."}</Banner>
      ) : null}
      {me.user.referralCode === null ? null : (
        <Section title="Referral code">
          <p className="font-mono text-heading tracking-wider">{me.user.referralCode}</p>
          <p className="text-body-sm text-ink-muted">
            Share it with people you encourage to apply, so the college knows who referred them.
          </p>
        </Section>
      )}
      {bothRoles ? <ViewChoice roles={me.roles} /> : null}
      <ThemeChoice />
      <Section title="Google account">
        {me.user.googleLinked ? (
          <p className="text-body-sm">
            A Google account is linked. You can use it to sign in and to join online classes.
          </p>
        ) : institution.googleSignIn ? (
          <>
            <p className="text-body-sm">
              Link a Google account to sign in with it and to join online classes.
            </p>
            <GoogleButton
              href="/api/v1/auth/google/start?intent=link&returnTo=/profile"
              label="Link Google account"
            />
          </>
        ) : (
          <p className="text-body-sm text-ink-muted">
            Linking a Google account isn't available yet.
          </p>
        )}
      </Section>
      <TimezoneForm current={me.user.timezone} />
      <Section title="Notifications">
        <p className="text-body-sm">Choose which notifications also come by email.</p>
        <Link to="/notifications" className={buttonClass({ variant: "secondary" })}>
          Notification settings
        </Link>
      </Section>
      <DataExport />
      <SignOut />
    </div>
  );
}

/** §6.3: a person who is both a student and a Lecturer picks the Home they see first. */
function ViewChoice({ roles }: { roles: { isStudent: boolean; isLecturer: boolean } }) {
  const view = homeView(roles, useStoredView());
  const options: [HomeView, string, string][] = [
    ["student", "Student", "Your classes to join and your courses."],
    ["lecturer", "Lecturer", "The classes you teach, with Start class and roll call."],
  ];
  return (
    <Section title="Home shows">
      <fieldset>
        <legend className="sr-only">Home shows</legend>
        {options.map(([value, label, hint]) => (
          <Radio
            key={value}
            name="view"
            value={value}
            checked={view === value}
            onChange={() => {
              chooseView(value);
            }}
            label={
              <>
                <span className="block">{label}</span>
                <span className="block text-body-sm text-ink-muted">{hint}</span>
              </>
            }
          />
        ))}
      </fieldset>
      <p className="text-body-sm text-ink-muted">
        Both areas stay in the menu either way. This phone remembers your choice.
      </p>
    </Section>
  );
}

const THEMES: [ThemePreference, string][] = [
  ["system", "Same as this device"],
  ["light", "Light"],
  ["dark", "Dark"],
];

function ThemeChoice() {
  const { preference, setPreference } = useTheme();
  return (
    <Section title="Appearance">
      <fieldset>
        <legend className="sr-only">Theme</legend>
        {THEMES.map(([value, label]) => (
          <Radio
            key={value}
            name="theme"
            value={value}
            checked={preference === value}
            onChange={() => {
              setPreference(value);
            }}
            label={label}
          />
        ))}
      </fieldset>
    </Section>
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
  const { busy, problem, run } = useSubmit();
  return (
    <Card>
      <form
        aria-label="Timezone"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const timezone = formText(new FormData(event.currentTarget), "timezone");
          void run(() => updateMe(queryClient, { timezone }));
        }}
      >
        <h2 className="text-heading">Timezone</h2>
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        <TextField
          id="timezone"
          name="timezone"
          label="Your timezone"
          list="timezones"
          defaultValue={current}
          required
          hint={
            <>
              Times are shown in this zone, with Lagos time alongside when it differs. Right now
              it's <Time value={new Date().toISOString()} withDate={false} />.
            </>
          }
        />
        <datalist id="timezones">
          {knownZones().map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <Button type="submit" variant="primary" loading={busy}>
          Save timezone
        </Button>
      </form>
    </Card>
  );
}

/** Data subject access (TRD §19.4): everything GLIM holds about you, as a JSON file. */
function DataExport() {
  const { busy, problem, run } = useSubmit();
  return (
    <Section title="Your data">
      <p className="text-body-sm">
        Download everything the college holds about you, as a file you can keep.
      </p>
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      <Button
        variant="secondary"
        icon="download"
        loading={busy}
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
        Download my data
      </Button>
    </Section>
  );
}

function SignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { busy, run } = useSubmit();
  return (
    <Button
      variant="danger"
      block
      loading={busy}
      onClick={() => {
        void run(async () => {
          await signOut(queryClient);
          await navigate({ to: "/login" });
        });
      }}
    >
      Sign out
    </Button>
  );
}
