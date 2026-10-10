import { useEffect, useState, type ReactNode } from "react";
import { Crest } from "../design/crest";
import { Icon, type IconName } from "../design/icons";
import { Avatar } from "../components/ui/avatar";
import { Badge, type BadgeStatus } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox, Radio, Switch } from "../components/ui/choice";
import { ConfirmDialog, Sheet } from "../components/ui/dialog";
import { Disclosure } from "../components/ui/disclosure";
import { EmptyState } from "../components/ui/empty-state";
import { Select, TextField } from "../components/ui/field";
import { IconButton } from "../components/ui/icon-button";
import { Menu } from "../components/ui/menu";
import { OfflineBanner, QueuedPill } from "../components/ui/offline";
import { ProgressBar } from "../components/ui/progress-bar";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { Tabs } from "../components/ui/tabs";

/**
 * The design-system gallery (handoff §15.1 WP-UI-03, UQ-6): every primitive and state, light and
 * dark side by side, for review and for the axe and keyboard checks in e2e/design-system.spec.ts.
 * Only built when VITE_DEV_UI=true, so it never ships.
 */

const STATUSES: BadgeStatus[] = [
  "scheduled",
  "open",
  "live",
  "ended",
  "no_show",
  "processing",
  "available",
  "cancelled",
  "present",
  "partial",
  "absent",
  "excused",
  "provisional",
  "approved",
  "failed",
  "draft",
];

const ICONS: IconName[] = [
  "home",
  "book",
  "calendar",
  "play",
  "video",
  "headphones",
  "award",
  "user",
  "clock",
  "check",
  "alert",
  "info",
  "wifiOff",
  "phone",
  "chevronRight",
  "chevronLeft",
  "upload",
  "file",
  "users",
  "settings",
  "bell",
  "download",
  "search",
  "menu",
  "close",
  "signal",
];

/** §5, §12.5: names with diacritics, and copy about 30% longer than usual. */
const NAMES = ["Ụ̀kà Ọlọ́rùn", "Tunde Bakare", "Ẹ̀mí Adébáyọ̀ Ọláòṣebìkan"];
const LONG =
  "Introduction to the Pastoral Epistles and the Practice of Ministry in West African Churches";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-heading">{title}</h2>
      {children}
    </section>
  );
}

/** The static primitives, drawn once per theme. */
function Specimens({ theme }: { theme: "light" | "dark" }) {
  const [on, setOn] = useState(theme === "dark");
  const id = (name: string) => `${theme}-${name}`;
  return (
    <div data-theme={theme} className="space-y-6 rounded-lg bg-surface p-4 text-ink">
      <p className="text-label text-ink-muted">{theme === "light" ? "Light" : "Dark"} theme</p>
      <Section title={`Buttons (${theme})`}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon="upload">
            Submit assignment
          </Button>
          <Button variant="secondary">Watch recording</Button>
          <Button variant="quiet">Forgot password?</Button>
          <Button variant="live" icon="video">
            Join live class
          </Button>
          <Button variant="danger">Revoke</Button>
          <Button variant="primary" loading>
            Finalize results
          </Button>
          <Button variant="secondary" disabled aria-describedby={id("why")}>
            Release grades
          </Button>
          <Button variant="secondary" size="sm" icon="download">
            Broadsheet (CSV)
          </Button>
        </div>
        <p id={id("why")} className="text-body-sm text-ink-muted">
          Release unlocks once every script is graded.
        </p>
        <div className="flex items-center gap-2">
          <IconButton icon="bell" label="Notifications, something new" dot />
          <IconButton icon="search" label="Search" />
          <Crest size={28} />
          <Crest size={36} />
        </div>
      </Section>
      <Section title={`Badges (${theme})`}>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((status) => (
            <Badge key={status} status={status} />
          ))}
          <Badge tone="warning">To grade</Badge>
        </div>
      </Section>
      <Section title={`Banners (${theme})`}>
        <Banner tone="info" title="Recording starts when you join">
          You join as co-host, so you can admit, mute and present.
        </Banner>
        <Banner tone="success">Sent. Your assignment was submitted at 21:14.</Banner>
        <Banner
          tone="warning"
          title="Link your Google account"
          action={
            <Button size="sm" variant="secondary">
              Link Google account
            </Button>
          }
          onDismiss={() => undefined}
        >
          You need it to join live classes.
        </Banner>
        <Banner tone="danger" title="Something went wrong on our side">
          Try again. If it keeps happening, quote reference 4f2a-91.
        </Banner>
        <OfflineBanner />
        <QueuedPill count={1} noun={["submission", "submissions"]} />
      </Section>
      <Section title={`Form controls (${theme})`}>
        <TextField id={id("email")} label="Email" type="email" autoComplete="username" />
        <TextField id={id("middle")} label="Middle name" optional />
        <TextField
          id={id("answer")}
          label="Your answer"
          multiline
          hint="412 words · aim for 500–700"
        />
        <TextField id={id("score")} label="Score out of 20" error="Enter a number from 0 to 20." />
        <TextField id={id("read")} label="Matric Number" readOnly value="GLIM/DIP/2027/0001" />
        <Select id={id("level")} label="Level">
          <option>Year 1</option>
          <option>Year 2</option>
        </Select>
        <Checkbox label="Email me a daily digest" defaultChecked />
        <fieldset>
          <legend className="text-label">Attendance</legend>
          <Radio label="Present" name={id("status")} defaultChecked />
          <Radio label="Excused" name={id("status")} />
        </fieldset>
        <Switch
          label="Data saver"
          hint="Starts every video at the lowest quality."
          checked={on}
          onCheckedChange={setOn}
        />
      </Section>
      <Section title={`Cards and lists (${theme})`}>
        <Card>
          <p className="font-mono text-code text-brand">PAS 101</p>
          <p className="line-clamp-2 text-heading">{LONG}</p>
          <ProgressBar label="Recordings watched" value={42} />
        </Card>
        <Card list>
          {NAMES.map((name) => (
            <div key={name} className="flex items-center gap-3 px-4 py-3.5">
              <Avatar name={name} />
              <span className="min-w-0 flex-1 truncate text-subhead" title={name}>
                {name}
              </span>
              <Badge status="present" />
            </div>
          ))}
        </Card>
        <Disclosure summary="2025/26 · First semester · GPA 4.20">
          <ProgressBar label="Watched" value={60} thin />
        </Disclosure>
        <SkeletonGroup label="Loading your courses">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </SkeletonGroup>
        <Card>
          <EmptyState icon="calendar" title="No classes today" headingLevel={3}>
            Your next class is Tue 13 Oct, 10:00.
          </EmptyState>
        </Card>
      </Section>
      <Section title={`Icons (${theme})`}>
        <ul className="grid grid-cols-6 gap-3 text-ink-muted">
          {ICONS.map((name) => (
            <li key={name} className="flex flex-col items-center gap-1 text-caption">
              <Icon name={name} />
              {name}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/** Overlays render into <body>, so they follow the page theme; the toggle switches it. */
function Interactive() {
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [tab, setTab] = useState("overview");
  const [done, setDone] = useState<string | null>(null);
  return (
    <Section title="Interactive">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setSheet(true);
          }}
        >
          Choose quality
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            setConfirm(true);
          }}
        >
          Change attendance
        </Button>
        <Menu
          trigger={<IconButton icon="menu" label="More actions" />}
          items={[
            { label: "Profile", icon: "user", onSelect: () => undefined },
            { label: "Sign out", onSelect: () => undefined },
          ]}
        />
      </div>
      {done ? <Banner tone="success">{done}</Banner> : null}
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Video quality"
        description="Lower quality uses less data."
        footer={
          <Button
            variant="primary"
            block
            onClick={() => {
              setSheet(false);
            }}
          >
            Done
          </Button>
        }
      >
        <Radio label="Auto (saves data)" name="quality" defaultChecked />
        <Radio label="144p · about 40 MB per hour" name="quality" />
      </Sheet>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Change attendance for Tunde Bakare?"
        confirmLabel="Mark as Excused"
        reason={{ label: "Reason" }}
        onConfirm={(reason) => {
          setConfirm(false);
          setDone(`Marked Excused: ${reason}`);
        }}
      >
        This replaces the computed status. Tunde will see it on their attendance record.
      </ConfirmDialog>
      <Tabs
        label="Course sections"
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "recordings", label: "Recordings" },
          { value: "work", label: "Work", count: 2 },
        ]}
        value={tab}
        onValueChange={setTab}
      >
        {(value) => <p className="text-body">Showing {value}.</p>}
      </Tabs>
    </Section>
  );
}

export function DevUiPage() {
  const [pageTheme, setPageTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    document.documentElement.dataset.theme = pageTheme;
    return () => {
      document.documentElement.dataset.theme = "light";
    };
  }, [pageTheme]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-title">Design system</h1>
        <Button
          size="sm"
          onClick={() => {
            setPageTheme(pageTheme === "light" ? "dark" : "light");
          }}
        >
          {pageTheme === "light" ? "Dark page" : "Light page"}
        </Button>
      </div>
      <Interactive />
      <div className="grid gap-4 lg:grid-cols-2">
        <Specimens theme="light" />
        <Specimens theme="dark" />
      </div>
    </div>
  );
}
