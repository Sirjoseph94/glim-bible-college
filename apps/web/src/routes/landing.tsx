import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { institutionQuery } from "../api/institution";
import { currentIntakeQuery, programmeLength } from "../api/intake";
import { LoadFailed } from "../components/app/page-states";
import { IntakeStatus } from "../components/app/intake-status";
import { InstitutionName } from "../components/app/shell-parts";
import { PublicTopBar } from "../components/app/signed-out-shell";
import { Button, buttonClass } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { Crest } from "../design/crest";
import { Icon, type IconName } from "../design/icons";

/**
 * What studying here looks like, in the product's own terms (GLOSSARY.md). Every line is
 * something the platform does today; nothing here is made up about the college.
 */
const STUDY: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "video",
    title: "Join Class Meetings online",
    body: "Online students join Class Meetings on Google Meet from a phone or computer. On-campus students meet in the Room.",
  },
  {
    icon: "play",
    title: "Watch the recordings",
    body: "Missed a class or want to go over it again? Recordings stay with the course, and you pick up where you left off.",
  },
  {
    icon: "file",
    title: "Hand in your work anywhere",
    body: "Submit assignments and take quizzes on your phone. Your answers are kept on the device until the connection comes back.",
  },
  {
    icon: "award",
    title: "Follow your results",
    body: "See your grades as Lecturers release them, then your semester results, and request a transcript that anyone can verify.",
  },
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
        <div className="glim-gutter mx-auto w-full max-w-content space-y-8 pb-8 lg:space-y-12 lg:pb-12">
          <Programmes />
          <HowYouStudy />
          <HowToApply />
          <VerifyTranscript />
        </div>
      </main>
      <Footer />
    </div>
  );
}

function TopBar() {
  const institution = useQuery(institutionQuery);
  return (
    <PublicTopBar
      institutionName={institution.data?.name}
      action={
        <Link to="/login" className={buttonClass({ variant: "secondary", size: "sm" })}>
          Sign in
        </Link>
      }
    />
  );
}

function Hero() {
  return (
    <section
      aria-labelledby="landing-title"
      className="glim-gutter mx-auto grid w-full max-w-content gap-6 py-8 lg:grid-cols-2 lg:items-center lg:gap-8 lg:py-12"
    >
      <div className="space-y-4">
        <p className="text-label text-brand">Certificate and Diploma programmes</p>
        <h1 id="landing-title" className="text-display">
          Study theology on campus or online
        </h1>
        <p className="max-w-prose text-body text-ink-muted">
          Learn with your Lecturers in the classroom or from wherever you are. Join live classes,
          watch the recordings, hand in your work and follow your results, all from your phone.
        </p>
        <div className="flex flex-col gap-3 md:flex-row">
          <Button asChild variant="primary" icon="chevronRight">
            <Link to="/apply">Apply now</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </div>
      <Admissions />
    </section>
  );
}

/**
 * Where the Intake stands. The GLIM-green band is the identity fill (§4.1); the crest sits on the
 * card below it, never on the green (§7.3).
 */
function Admissions() {
  const current = useQuery(currentIntakeQuery);
  return (
    <section
      aria-labelledby="landing-admissions"
      className="overflow-hidden rounded-lg border border-line bg-surface-raised"
    >
      <div aria-hidden="true" className="glim-identity-band h-3" />
      <div className="space-y-4 p-5 lg:p-6">
        <div className="flex items-center gap-3">
          <Crest size={72} />
          <h2 id="landing-admissions" className="text-title">
            Admissions
          </h2>
        </div>
        <div aria-live="polite" className="min-h-12">
          {current.isPending ? (
            <SkeletonGroup label="Loading the Intake dates">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
            </SkeletonGroup>
          ) : current.isError ? (
            <LoadFailed what="the Intake dates" onRetry={() => void current.refetch()} />
          ) : (
            <IntakeStatus intake={current.data.intake} />
          )}
        </div>
        <p className="text-body-sm text-ink-muted">
          The college admits students once a year. Everyone admitted in an Intake starts together.
        </p>
      </div>
    </section>
  );
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div className="space-y-1">
        <h2 id={id} className="text-title">
          {title}
        </h2>
        {intro ? <p className="max-w-prose text-body text-ink-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Programmes() {
  const current = useQuery(currentIntakeQuery);
  return (
    <Section
      id="landing-programmes"
      title="Programmes"
      intro="Each Programme leads to an award. You choose one when you apply, and whether to study On-campus or Online."
    >
      {current.isPending ? (
        <SkeletonGroup label="Loading the Programmes">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
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
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {current.data.programmes.map((p) => (
            <li key={p.id}>
              <Card className="h-full space-y-1">
                <p className="font-mono text-code text-brand">{p.code}</p>
                <h3 className="text-heading">{p.name}</h3>
                <p className="text-body-sm text-ink-muted">{programmeLength(p)}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function HowYouStudy() {
  return (
    <Section id="landing-study" title="How you study">
      <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {STUDY.map(({ icon, title, body }) => (
          <li key={title}>
            <Card className="h-full space-y-3">
              <span className="inline-flex size-11 items-center justify-center rounded-pill bg-brand-soft text-brand">
                <Icon name={icon} size={22} />
              </span>
              <h3 className="text-subhead">{title}</h3>
              <p className="text-body-sm text-ink-muted">{body}</p>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function HowToApply() {
  return (
    <Section id="landing-apply" title="How to apply">
      <Card>
        <ol className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ title, body }, index) => (
            <li key={title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-pill bg-brand-soft text-label text-brand"
              >
                {index + 1}
              </span>
              <div className="space-y-1">
                <h3 className="text-subhead">{title}</h3>
                <p className="text-body-sm text-ink-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-5 border-t border-line pt-4">
          <Button asChild variant="primary" icon="chevronRight" block className="md:w-auto">
            <Link to="/apply">See the Intake and apply</Link>
          </Button>
        </div>
      </Card>
    </Section>
  );
}

/** For employers and other institutions: the code printed on a transcript opens /verify/:code. */
function VerifyTranscript() {
  const navigate = useNavigate();
  return (
    <Section
      id="landing-verify"
      title="Verify a transcript"
      intro="Every transcript the college issues carries a verification code. Enter it to see whether the transcript is valid."
    >
      <Card>
        <form
          className="flex flex-col gap-3 md:flex-row md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("code");
            const code = typeof value === "string" ? value.trim().toUpperCase() : "";
            if (code !== "") void navigate({ to: "/verify/$code", params: { code } });
          }}
        >
          <div className="md:flex-1">
            <TextField
              id="verification-code"
              name="code"
              label="Verification code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
          </div>
          <Button type="submit" variant="secondary" icon="search">
            Check transcript
          </Button>
        </form>
      </Card>
    </Section>
  );
}

const FOOTER_LINK = "inline-flex min-h-tap items-center text-body-sm text-brand underline";

function Footer() {
  const institution = useQuery(institutionQuery);
  return (
    <footer className="border-t border-line bg-surface-raised">
      <div className="glim-gutter mx-auto flex w-full max-w-content flex-col gap-4 py-6 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Crest size={28} />
          <InstitutionName name={institution.data?.name} />
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-5">
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
              <a href="#landing-verify" className={FOOTER_LINK}>
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
            <li>
              <Link to="/contact" className={FOOTER_LINK}>
                Contact
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
