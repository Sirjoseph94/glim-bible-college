import { useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { CurrentIntake } from "@glim/contracts";
import { institutionQuery } from "../api/institution";
import { currentIntakeQuery, PROGRAMME_SHAPE } from "../api/intake";
import { LoadFailed } from "../components/app/page-states";
import { IntakeStatus } from "../components/app/intake-status";
import { LEGAL_CONTACT, LEGAL_NAME } from "../components/app/legal-links";
import { InstitutionName } from "../components/app/shell-parts";
import { CalendarDate } from "../components/time";
import { Badge } from "../components/ui/badge";
import { Button, buttonClass } from "../components/ui/button";
import { Card, cardClass } from "../components/ui/card";
import { Disclosure } from "../components/ui/disclosure";
import { EmptyState } from "../components/ui/empty-state";
import { TextField } from "../components/ui/field";
import { ProgressBar } from "../components/ui/progress-bar";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { cn } from "../design/cn";
import { Crest } from "../design/crest";
import { Icon, type IconName } from "../design/icons";

/**
 * Facts the college hasn't confirmed yet. D-UI-02: the page states nothing about the college
 * that the data or the glossary doesn't, so these show as placeholders until the owner gives them.
 */
const TO_CONFIRM = {
  fees: "[FEES]",
  entryRequirements: "[ENTRY REQUIREMENTS]",
  phone: "[PHONE NUMBER]",
  address: "[POSTAL ADDRESS]",
};

const APPLY_LABEL = "See the Intake and apply";

/** The header's in-page links, in the order the sections appear. */
const NAV: { href: string; label: string }[] = [
  { href: "#programmes", label: "Programmes" },
  { href: "#how-to-apply", label: "How to apply" },
  { href: "#study-online", label: "Study online" },
];

/** The steps of TRD §10. The Offer's deadline is set per Intake, so the Offer states it. */
const STEPS: { title: string; body: string }[] = [
  {
    title: "Sign in with Google",
    body: "You apply with your Google account. If you don't have one, it's free to create.",
  },
  {
    title: "Fill in your application",
    body: "Choose a Programme and a Study Mode: On-campus or Online. Your draft is saved as you go.",
  },
  { title: "Submit it", body: "You get a receipt by email with your Application Reference No." },
  {
    title: "Accept your Offer",
    body: "If the college admits you, accept the Offer by the date it gives to become a student.",
  },
];

/** The two Study Modes (TRD Δ3-09 for exams). Everything else is the same in both. */
const MODES: { icon: IconName; title: string; intro: string; points: string[] }[] = [
  {
    icon: "users",
    title: "On-campus",
    intro: "Learn alongside your Lecturers and classmates.",
    points: [
      "Meet in the Room for each Class Meeting.",
      "Write your exams on paper in the Room. Your Lecturer enters the scores.",
      "Watch the recording afterwards to go over a class again.",
    ],
  },
  {
    icon: "video",
    title: "Online",
    intro: "Study from wherever you are, on your phone or a computer.",
    points: [
      "Join each Class Meeting live on Google Meet.",
      "Take your exams online, with a time limit.",
      "Hand in assignments and take quizzes from your phone.",
    ],
  },
];

/**
 * What GLIM LMS does on a weak connection, in the product's own terms. Every line is something
 * the platform does today (TRD C-07, §13.4): there is no audio-only option in v1 (D-09).
 */
const LOW_DATA: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "video",
    title: "Join live from your phone",
    body: "When your class starts, tap Join live class. It opens in Google Meet.",
  },
  {
    icon: "phone",
    title: "Dial in when the signal is weak",
    body: "If your data can't carry the call, join by phone with the number and PIN on the class card, where Google provides one.",
  },
  {
    icon: "play",
    title: "Resume any recording",
    body: "Recordings stay with the course, and you pick up where you stopped.",
  },
  {
    icon: "signal",
    title: "Choose how much data to use",
    body: "Set a recording to 144p to use about 40 MB per hour, or 240p for about 70 MB per hour.",
  },
  {
    icon: "file",
    title: "Hand in work on a poor connection",
    body: "Your answers are kept on your phone until the connection comes back.",
  },
  {
    icon: "clock",
    title: "Times in West Africa Time",
    body: "Class times use the 24-hour clock in WAT, with your own time beside them if you live elsewhere.",
  },
];

/**
 * The public landing page at / for people who aren't signed in (decision D-UI-02). It uses only
 * public data: the institution's name and the current Intake with its Programmes. The headline
 * doesn't wait for either, so the largest text paints with the first chunk (§14).
 */
export function LandingPage() {
  return (
    <div className="min-h-dvh bg-surface text-ink">
      <TopBar />
      <main>
        <Hero />
        <HowToApply />
        <Programmes />
        <TwoWaysToStudy />
        <WeakSignals />
        <Questions />
        <FinalCall />
      </main>
      <Footer />
    </div>
  );
}

const NAV_LINK =
  "inline-flex min-h-tap items-center rounded-md px-3 text-body text-ink hover:bg-surface-sunken";

function NavLinks({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  return (
    <ul className={className}>
      {NAV.map(({ href, label }) => (
        <li key={href}>
          <a href={href} className={NAV_LINK} onClick={onNavigate}>
            {label}
          </a>
        </li>
      ))}
      <li>
        <Link to="/contact" className={NAV_LINK} onClick={onNavigate}>
          Contact
        </Link>
      </li>
    </ul>
  );
}

/**
 * The crest and name, the section links and Sign in. On phones the links (and, below md, Sign in)
 * fold into a native details menu, so it opens before the script has loaded.
 */
function TopBar() {
  const institution = useQuery(institutionQuery);
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => menu.current?.removeAttribute("open");
  return (
    <header className="glim-safe-top relative border-b border-line bg-surface-raised">
      <div className="glim-gutter mx-auto flex h-16 w-full max-w-content items-center gap-2">
        <Link to="/" className="flex min-h-tap min-w-0 flex-1 items-center gap-2">
          <Crest size={32} />
          <InstitutionName name={institution.data?.name} testId="institution-name" />
        </Link>
        <nav aria-label="Main" className="hidden lg:block">
          <NavLinks className="flex items-center gap-1" />
        </nav>
        {/* cn() doesn't merge, so the hiding sits on a wrapper rather than beside inline-flex. */}
        <div className="hidden md:block">
          <Link to="/login" className={buttonClass({ variant: "secondary", size: "sm" })}>
            Sign in
          </Link>
        </div>
        <details
          ref={menu}
          className="group lg:hidden"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !menu.current?.open) return;
            close();
            menu.current.querySelector("summary")?.focus();
          }}
        >
          <summary
            className={cn(
              buttonClass({ variant: "quiet", size: "sm" }),
              "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
            )}
          >
            <span className="inline-flex items-center gap-2 group-open:hidden">
              <Icon name="menu" size={16} />
              Menu
            </span>
            <span className="hidden items-center gap-2 group-open:inline-flex">
              <Icon name="close" size={16} />
              Close
            </span>
          </summary>
          <div className="absolute inset-x-0 top-full z-nav border-b border-line bg-surface-raised">
            <nav aria-label="Main" className="glim-gutter mx-auto w-full max-w-content py-3">
              <NavLinks onNavigate={close} className="space-y-1" />
              <Link
                to="/login"
                className={cn(buttonClass({ variant: "secondary", block: true }), "mt-3 md:hidden")}
              >
                Sign in to GLIM LMS
              </Link>
            </nav>
          </div>
        </details>
      </div>
    </header>
  );
}

/**
 * The GLIM-green identity band (§4.1) with dark text. It keeps the light tokens in both themes,
 * so its buttons and badge read the same on the fixed green. The crest stays off the green (§7.3).
 */
function Hero() {
  return (
    <section aria-labelledby="landing-title" data-theme="light" className="glim-identity-band">
      <div className="glim-gutter mx-auto w-full max-w-content py-10 lg:py-20">
        <div className="max-w-3xl space-y-5 lg:space-y-6">
          <IntakeBadge />
          <h1 id="landing-title" className="text-hero lg:text-hero-lg">
            Study the Word. Serve with purpose.
          </h1>
          <p className="max-w-prose text-body lg:text-heading lg:font-normal">
            Earn a Certificate halfway and a Diploma when you finish, studying on campus or online
            from wherever you are.
          </p>
          <div className="flex flex-col gap-3 pt-1 md:flex-row">
            <Button asChild variant="primary" icon="chevronRight" block className="md:w-auto">
              <Link to="/apply">{APPLY_LABEL}</Link>
            </Button>
            <Button asChild variant="secondary" block className="md:w-auto">
              <Link to="/login">Sign in to GLIM LMS</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function IntakeWords({ intake }: { intake: CurrentIntake["intake"] }) {
  if (intake === null) return <>No Intake scheduled yet</>;
  const code = <span className="font-mono">{intake.code}</span>;
  if (intake.status === "OPEN")
    return (
      <>
        {code} · Applications open until <CalendarDate value={intake.closesOn} />
      </>
    );
  if (intake.status === "PLANNED")
    return (
      <>
        {code} · Applications open on <CalendarDate value={intake.opensOn} />
      </>
    );
  return <>{code} · Applications closed</>;
}

/** Where the Intake stands, in a pill above the headline. Nothing shows if it can't load. */
function IntakeBadge() {
  const current = useQuery(currentIntakeQuery);
  return (
    <div aria-live="polite" className="min-h-8">
      {current.isPending ? (
        <SkeletonGroup label="Loading the Intake dates">
          <Skeleton className="h-8 w-64 rounded-pill" />
        </SkeletonGroup>
      ) : current.isError ? null : (
        <p
          data-testid="intake-badge"
          className="inline-flex min-h-8 items-center gap-2 rounded-pill bg-surface-raised px-3 py-1 text-label text-ink"
        >
          <Icon name="calendar" size={16} />
          <span>
            <IntakeWords intake={current.data.intake} />
          </span>
        </p>
      )}
    </div>
  );
}

function Section({
  id,
  anchor,
  title,
  intro,
  children,
}: {
  id: string;
  anchor?: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={anchor}
      aria-labelledby={id}
      className="glim-gutter mx-auto w-full max-w-content space-y-5 py-8 lg:space-y-6 lg:py-12"
    >
      <div className="space-y-2">
        <h2 id={id} className="text-display">
          {title}
        </h2>
        {intro ? <p className="max-w-prose text-body text-ink-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Four numbered steps joined by a line: down the left on phones, across from lg. The last step,
 * the one that makes you a student, is highlighted.
 */
function HowToApply() {
  const last = STEPS.length - 1;
  return (
    <Section
      id="landing-apply"
      anchor="how-to-apply"
      title="How to apply"
      intro="You apply online, from your phone or a computer, in four steps."
    >
      <ol className="grid gap-5 lg:grid-cols-4">
        {STEPS.map(({ title, body }, index) => (
          <li
            key={title}
            className={cn(
              "relative flex gap-4 rounded-md border p-4 lg:flex-col",
              index === last ? "border-brand bg-brand-soft" : "border-line bg-surface-raised",
            )}
          >
            {index < last ? (
              <span
                aria-hidden="true"
                className="absolute top-14 -bottom-10 left-9 z-10 -ml-px w-0.5 bg-line-strong lg:top-9 lg:-right-10 lg:bottom-auto lg:left-14 lg:-mt-px lg:ml-0 lg:h-0.5 lg:w-auto"
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 inline-flex size-10 shrink-0 items-center justify-center rounded-pill text-label",
                index === last
                  ? "bg-brand text-brand-on"
                  : "border border-brand bg-surface-raised text-brand",
              )}
            >
              {index + 1}
            </span>
            <div className="space-y-1">
              <h3 className="text-heading">
                <span className="sr-only">Step {index + 1}: </span>
                {title}
              </h3>
              <p className="text-body-sm text-ink-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <Button asChild variant="primary" icon="chevronRight" block className="md:w-auto">
        <Link to="/apply">{APPLY_LABEL}</Link>
      </Button>
    </Section>
  );
}

function Programmes() {
  const current = useQuery(currentIntakeQuery);
  return (
    <Section
      id="landing-programmes"
      anchor="programmes"
      title="Programmes"
      intro="Each Programme leads to an award. You choose one when you apply, and whether to study On-campus or Online."
    >
      {current.isPending ? (
        <SkeletonGroup label="Loading the Programmes">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-40 rounded-md" />
            <Skeleton className="h-40 rounded-md" />
          </div>
        </SkeletonGroup>
      ) : current.isError ? (
        <LoadFailed what="the Programmes" onRetry={() => void current.refetch()} />
      ) : current.data.programmes.length === 0 ? (
        <Card>
          <EmptyState icon="book" title="No Programmes to show yet">
            They're listed here when the college opens its next Intake.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {current.data.programmes.map((p) => (
            <li
              key={p.id}
              className="flex flex-col overflow-hidden rounded-md border border-line bg-surface-raised"
            >
              <p className="bg-brand-soft px-4 py-3 font-mono text-code text-brand">{p.code}</p>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <h3 className="text-heading">{p.name}</h3>
                <p className="flex gap-2 text-body-sm text-ink-muted">
                  <span className="pt-0.5">
                    <Icon name="clock" size={16} />
                  </span>
                  {PROGRAMME_SHAPE}
                </p>
                <ul aria-label="Study Modes" className="mt-auto flex flex-wrap gap-2">
                  <li>
                    <Badge tone="neutral">On-campus</Badge>
                  </li>
                  <li>
                    <Badge tone="neutral">Online</Badge>
                  </li>
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TwoWaysToStudy() {
  return (
    <Section
      id="landing-modes"
      title="Two ways to study"
      intro="You take the same courses either way, one at a time, and your work goes into the same gradebook."
    >
      <ul className="grid gap-4 md:grid-cols-2">
        {MODES.map(({ icon, title, intro, points }) => (
          <li
            key={title}
            className="space-y-4 rounded-lg border border-line bg-surface-raised p-5 lg:p-6"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex size-11 items-center justify-center rounded-pill bg-brand-soft text-brand">
                <Icon name={icon} size={22} />
              </span>
              <div>
                <h3 className="text-title">{title}</h3>
                <p className="text-body-sm text-ink-muted">{intro}</p>
              </div>
            </div>
            <ul className="space-y-3 border-t border-line pt-4">
              {points.map((point) => (
                <li key={point} className="flex gap-3 text-body">
                  <span className="pt-0.5 text-brand">
                    <Icon name="check" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The LMS on a weak connection: what it does, beside a phone showing a class card. */
function WeakSignals() {
  return (
    <div className="border-y border-line bg-surface-raised">
      <Section
        id="landing-signals"
        anchor="study-online"
        title="Built for weak signals"
        intro="Once you're a student, you study in GLIM LMS. It is made for phones and mobile data, so a poor connection doesn't keep you out of class."
      >
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-1">
            {LOW_DATA.map(({ icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-brand-soft text-brand">
                  <Icon name={icon} />
                </span>
                <div className="space-y-1">
                  <h3 className="text-heading">{title}</h3>
                  <p className="text-body-sm text-ink-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>
          <PhoneMockup />
        </div>
      </Section>
    </div>
  );
}

/**
 * A picture of the student's Today screen, drawn with the real components' styles. It is hidden
 * from screen readers (the list beside it says the same), and its button is not a control.
 */
function PhoneMockup() {
  return (
    <figure className="mx-auto w-full max-w-sm space-y-3 lg:sticky lg:top-6">
      <div aria-hidden="true" className="rounded-lg border-2 border-line-strong bg-surface p-3">
        <div className="mx-auto mb-4 h-1.5 w-16 rounded-pill bg-line" />
        <p className="px-1 pb-2 text-label text-ink-muted">Today</p>
        <div className="space-y-3">
          <div className={cn(cardClass(), "space-y-3")}>
            <div className="flex items-center justify-between gap-2">
              <Badge status="live" />
              <span className="text-meta text-ink-muted tabular-nums">18:00–19:30 WAT</span>
            </div>
            <div className="space-y-0.5">
              <p className="font-mono text-code text-ink-muted">[COURSE CODE]</p>
              <p className="text-subhead">[COURSE NAME]</p>
              <p className="text-meta text-ink-muted">Class Meeting · Online</p>
            </div>
            <span className={buttonClass({ variant: "live", block: true })}>
              <Icon name="video" />
              Join live class
            </span>
            <p className="flex items-center gap-2 text-body-sm text-ink-muted">
              <Icon name="phone" size={16} />
              Weak signal? Dial in by phone
            </p>
          </div>
          <div className={cn(cardClass(), "space-y-3")}>
            <p className="flex items-center gap-2 text-label">
              <Icon name="play" size={16} />
              Recording · last week's class
            </p>
            <ProgressBar thin label="Watched" value={40} />
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-meta text-ink-muted">
              <span className="tabular-nums">Resume at 23:40</span>
              <span>144p · ≈ 40 MB per hour</span>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="text-center text-body-sm text-ink-muted">
        A live class and a recording in GLIM LMS, as they look on a phone.
      </figcaption>
    </figure>
  );
}

function Questions() {
  const current = useQuery(currentIntakeQuery);
  const statement = current.data?.statementOfFaithUrl ?? null;
  const items: { question: string; answer: ReactNode }[] = [
    {
      question: "How much does it cost to study?",
      answer: (
        <p>
          {TO_CONFIRM.fees} Fees aren't paid on this website. To ask about them, write to{" "}
          <MailLink />.
        </p>
      ),
    },
    {
      question: "What do I need to apply?",
      answer: (
        <>
          <p>{TO_CONFIRM.entryRequirements}</p>
          <p>
            To apply online you need a Google account and a passport photograph to upload. You also
            read and agree to the college's{" "}
            {statement === null ? (
              "Statement of Faith"
            ) : (
              <a href={statement} className="text-brand underline">
                Statement of Faith
              </a>
            )}
            , and sign by typing your name.
          </p>
        </>
      ),
    },
    {
      question: "When do applications close?",
      answer: (
        <>
          {current.isPending ? (
            <p>Loading the Intake dates…</p>
          ) : current.isError ? (
            <p>The Intake dates couldn't load. The Apply page shows them.</p>
          ) : (
            <IntakeStatus intake={current.data.intake} />
          )}
          <p>
            Applications are reviewed as they arrive, so you can apply as soon as you're ready. If
            the college admits you, accept the Offer by the date it gives, or it lapses.
          </p>
        </>
      ),
    },
    {
      question: "Do I need a Google account?",
      answer: (
        <p>
          Yes. You sign in with Google to apply, and online students use it to join Class Meetings
          on Google Meet. A Google account is free, and you can create one at accounts.google.com.
        </p>
      ),
    },
  ];
  return (
    <Section id="landing-faq" anchor="questions" title="Questions">
      <div className={cn(cardClass({ list: true }), "max-w-3xl")}>
        {items.map(({ question, answer }) => (
          <div key={question} className="px-4">
            <Disclosure summary={question}>
              <div className="max-w-prose space-y-2 pl-7 text-body text-ink-muted">{answer}</div>
            </Disclosure>
          </div>
        ))}
      </div>
    </Section>
  );
}

function FinalCall() {
  return (
    <section
      aria-labelledby="landing-cta"
      className="glim-gutter mx-auto w-full max-w-content pt-4 pb-10 lg:pb-16"
    >
      <div className="flex flex-col gap-5 rounded-lg border border-line bg-brand-soft p-6 lg:flex-row lg:items-center lg:justify-between lg:p-10">
        <div className="space-y-2">
          <h2 id="landing-cta" className="text-display">
            Start your application
          </h2>
          <p className="max-w-prose text-body text-ink-muted">
            Check the Intake dates and Programmes, then apply with your Google account. Your draft
            is saved as you go.
          </p>
        </div>
        <Button asChild variant="primary" icon="chevronRight" block className="shrink-0 md:w-auto">
          <Link to="/apply">{APPLY_LABEL}</Link>
        </Button>
      </div>
    </section>
  );
}

function MailLink() {
  return (
    <a href={`mailto:${LEGAL_CONTACT}`} className="text-brand underline">
      {LEGAL_CONTACT}
    </a>
  );
}

/** For employers and other institutions: the code printed on a transcript opens /verify/:code. */
function VerifyTranscript() {
  const navigate = useNavigate();
  return (
    <section aria-labelledby="landing-verify" id="verify" className="space-y-3">
      <div className="space-y-1">
        <h2 id="landing-verify" className="text-heading">
          Verify a transcript
        </h2>
        <p className="text-body-sm text-ink-muted">
          Enter the verification code printed on a transcript to see whether it is valid.
        </p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("code");
          const code = typeof value === "string" ? value.trim().toUpperCase() : "";
          if (code !== "") void navigate({ to: "/verify/$code", params: { code } });
        }}
      >
        <TextField
          id="verification-code"
          name="code"
          label="Verification code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
        <Button type="submit" variant="secondary" icon="search">
          Check transcript
        </Button>
      </form>
    </section>
  );
}

const FOOTER_LINK = "inline-flex min-h-tap items-center text-body-sm text-brand underline";

function Footer() {
  const institution = useQuery(institutionQuery);
  return (
    <footer className="border-t border-line bg-surface-raised">
      <div className="glim-gutter mx-auto grid w-full max-w-content gap-8 py-8 md:grid-cols-2 lg:grid-cols-3 lg:py-12">
        <div className="space-y-3">
          <div className="flex min-w-0 items-center gap-2">
            <Crest size={32} />
            <InstitutionName name={institution.data?.name} />
          </div>
          <address className="space-y-1 text-body-sm text-ink-muted not-italic">
            <p>
              <a href={`mailto:${LEGAL_CONTACT}`} className={FOOTER_LINK}>
                {LEGAL_CONTACT}
              </a>
            </p>
            <p>{TO_CONFIRM.phone}</p>
            <p>{TO_CONFIRM.address}</p>
          </address>
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-x-5">
            <li>
              <a href="#programmes" className={FOOTER_LINK}>
                Programmes
              </a>
            </li>
            <li>
              <a href="#how-to-apply" className={FOOTER_LINK}>
                How to apply
              </a>
            </li>
            <li>
              <Link to="/apply" className={FOOTER_LINK}>
                Apply
              </Link>
            </li>
            <li>
              <Link to="/login" className={FOOTER_LINK}>
                Sign in
              </Link>
            </li>
            <li>
              <Link to="/contact" className={FOOTER_LINK}>
                Contact
              </Link>
            </li>
            <li>
              <a href="#verify" className={FOOTER_LINK}>
                Verify a transcript
              </a>
            </li>
            <li>
              <Link to="/privacy" className={FOOTER_LINK}>
                Privacy policy
              </Link>
            </li>
            <li>
              <Link to="/terms" className={FOOTER_LINK}>
                Terms of service
              </Link>
            </li>
          </ul>
        </nav>
        <VerifyTranscript />
      </div>
      <div className="border-t border-line">
        <p className="glim-gutter mx-auto w-full max-w-content py-4 text-body-sm text-ink-muted">
          © {LEGAL_NAME}
        </p>
      </div>
    </footer>
  );
}
