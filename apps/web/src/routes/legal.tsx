import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * The privacy policy and terms of service, public at /privacy and /terms. Every statement about
 * data follows docs/compliance/ropa.md and the code it cites (cookies, device storage, retention);
 * change them together. Legal review is a launch gate (TRD C-41).
 */
export const LEGAL_NAME = "GLIM Bible College";
export const LEGAL_CONTACT = "online@glimbiblecollege.com";
const UPDATED = "29 October 2026";

const LINK = "text-brand underline";

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="space-y-6 pb-8">
      <header className="space-y-1">
        <h1 className="text-display">{title}</h1>
        <p className="text-body-sm text-ink-muted">Last updated {UPDATED}</p>
      </header>
      {children}
    </article>
  );
}

function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="max-w-prose space-y-3 text-body">
      <h2 id={id} className="text-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5">{children}</ul>;
}

function Contact() {
  return (
    <a href={`mailto:${LEGAL_CONTACT}`} className={LINK}>
      {LEGAL_CONTACT}
    </a>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <Part id="privacy-who" title="Who we are">
        <p>
          {LEGAL_NAME} runs this website and decides how the personal data in it is used: it is the
          data controller under the Nigeria Data Protection Act 2023. This policy explains what we
          collect, why, who helps us, how long we keep it and what you can ask us to do.
        </p>
        <p>
          Questions or requests about your data: <Contact />.
        </p>
      </Part>

      <Part id="privacy-what" title="What we collect and why">
        <Bullets>
          <li>
            <strong>Your account.</strong> Your name, email address, password (stored only as a
            secure hash) or the Google account you sign in with, your time zone, and for each
            sign-in the IP address and browser. We use these to run the service and keep it secure.
          </li>
          <li>
            <strong>Your application.</strong> Your personal and contact details, address, church
            and pastor details, education, passport photo and your answers about your spiritual
            background, used to decide on your admission. Your spiritual background is sensitive
            information: we ask for your explicit consent before you submit it, only the admissions
            team sees it, and it is never copied into your student record.
          </li>
          <li>
            <strong>Your studies.</strong> Your Matric Number, Programme and course enrollments, the
            work you submit, quiz answers, grades and feedback, and attendance, including when you
            join and leave online Class Meetings. We need these to teach and assess you.
          </li>
          <li>
            <strong>Class recordings.</strong> Class Meetings may be recorded, including the people
            who appear or speak. Recordings are published on the college's YouTube channel as
            unlisted videos, so that students can watch them again. Anyone who has the link can view
            an unlisted video.
          </li>
          <li>
            <strong>Results, awards and transcripts.</strong> Your results, GPA and CGPA, standing,
            award and the transcripts we issue, kept as your permanent academic record. When someone
            checks a transcript's verification code, they see only your initials, Programme, status
            and dates.
          </li>
          <li>
            <strong>Messages.</strong> The notifications and emails we send you, and whether they
            were delivered.
          </li>
          <li>
            <strong>A record of actions.</strong> Who did what in the system and when, with the IP
            address, so the college can account for changes and investigate problems.
          </li>
        </Bullets>
        <p>
          We use your data to give you the service you signed up for (our contract with you), to
          keep the service secure and the academic record accurate (our legitimate interests and
          legal obligations), and, for the sensitive answers in your application, because you
          consented.
        </p>
      </Part>

      <Part id="privacy-who-helps" title="Who helps us">
        <p>We don't sell your data. These providers process it for us, each only for its job:</p>
        <Bullets>
          <li>Hostinger runs the server, in the United Kingdom.</li>
          <li>Neon hosts the database, in Frankfurt, Germany.</li>
          <li>Cloudflare stores uploaded files and backups, in the European Union.</li>
          <li>
            Google provides sign-in with Google, Google Meet for online Class Meetings and YouTube
            for recordings.
          </li>
          <li>Brevo sends our emails, from France.</li>
        </Bullets>
        <p>
          This means your data is processed outside Nigeria. We make these transfers under the
          Nigeria Data Protection Act's rules for cross-border transfers.
        </p>
      </Part>

      <Part id="privacy-keep" title="How long we keep it">
        <Bullets>
          <li>Your account: for as long as you have one, or until you ask us to erase it.</li>
          <li>
            Sign-in records: a sign-in ends after 12 hours at most, or after 2 hours without
            activity (applicants aren't signed out for inactivity, so a long form isn't lost). Its
            record, with your IP address and browser, is deleted 7 days after it ends.
          </li>
          <li>
            Applications: deleted after the admissions period the college sets (12 months by
            default). Applications you start but never submit are deleted 12 months after you last
            edit them.
          </li>
          <li>
            Your academic record (results, awards, transcripts and coursework): kept permanently.
          </li>
          <li>Class recordings: until the college deletes them.</li>
          <li>Backups: encrypted weekly copies of the database, deleted after 12 weeks.</li>
        </Bullets>
      </Part>

      <Part id="privacy-rights" title="Your rights">
        <Bullets>
          <li>
            <strong>See your data.</strong> Signed in, go to your Profile and choose{" "}
            <em>Download my data</em> for a copy of everything the college holds about you.
          </li>
          <li>
            <strong>Correct it.</strong> Ask the college to correct anything that's wrong.
          </li>
          <li>
            <strong>Erase it.</strong> Ask us to erase your account. We delete your sign-in details,
            notifications, applications (with the sensitive answers) and photos. The law requires us
            to keep your academic record and our record of actions, which stay under a pseudonym
            instead of your name.
          </li>
          <li>
            <strong>Withdraw consent</strong> for the sensitive answers in your application, or{" "}
            <strong>object</strong> to how we use your data.
          </li>
        </Bullets>
        <p>
          Write to <Contact /> for any of these. If you're not satisfied with our answer, you can
          complain to the Nigeria Data Protection Commission.
        </p>
      </Part>

      <Part id="privacy-cookies" title="Cookies and storage on your device">
        <p>
          We use only the cookies the service needs to work. There are no advertising or analytics
          cookies.
        </p>
        <Bullets>
          <li>
            <code className="font-mono text-code">__Host-glim_sid</code> keeps you signed in.
          </li>
          <li>
            <code className="font-mono text-code">__Host-glim_oidc</code> exists for a few minutes
            while you sign in with Google.
          </li>
          <li>
            <code className="font-mono text-code">glim_youtube_state</code> is set only for staff
            while they connect the college's YouTube channel.
          </li>
        </Bullets>
        <p>
          Your browser also keeps work you submit while offline until the connection comes back,
          drafts of your assignment answers, and your display preferences, such as light or dark
          mode.
        </p>
      </Part>

      <Part id="privacy-security" title="Keeping it safe">
        <p>
          All traffic to the site is encrypted. Staff see only what their role needs, every change
          to a record is logged, passwords are stored only as secure hashes, and backups are
          encrypted.
        </p>
      </Part>

      <Part id="privacy-changes" title="Changes to this policy">
        <p>
          We update this page when what we do with your data changes, and change the date at the
          top. If a change matters to you, we'll tell you by email or in the app.
        </p>
      </Part>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <Part id="terms-about" title="About these terms">
        <p>
          These terms apply when you use the {LEGAL_NAME} website and its services, whether you're
          applying, studying, teaching or working for the college. By using the site you agree to
          them. Your studies are also governed by the college's academic policies; where they differ
          from these terms, the academic policies apply.
        </p>
      </Part>

      <Part id="terms-account" title="Your account">
        <Bullets>
          <li>Your account is for you alone. Don't share it or let anyone else sign in as you.</li>
          <li>
            Keep your password and Google account secure, and tell us at once if you think someone
            else has used your account.
          </li>
          <li>Give accurate information, especially in your application.</li>
        </Bullets>
      </Part>

      <Part id="terms-use" title="Using the site properly">
        <p>You agree not to:</p>
        <Bullets>
          <li>submit work that isn't your own, or help someone else do so;</li>
          <li>
            share class recordings, their links or course materials outside your course without
            permission;
          </li>
          <li>
            upload anything unlawful or harmful, or anything you don't have the right to share;
          </li>
          <li>
            try to reach accounts or data that aren't yours, or interfere with how the site works.
          </li>
        </Bullets>
      </Part>

      <Part id="terms-content" title="Your work and the college's materials">
        <p>
          You keep the rights to the work you submit. You allow the college to store it, assess it
          and keep it as part of your academic record. Course materials and class recordings belong
          to the college and its Lecturers. You may use them for your own studies.
        </p>
      </Part>

      <Part id="terms-recordings" title="Class recordings">
        <p>
          Class Meetings may be recorded and published on the college's YouTube channel as unlisted
          videos. If you join a recorded class, you may appear or be heard in the recording. Our{" "}
          <Link to="/privacy" className={LINK}>
            privacy policy
          </Link>{" "}
          explains how recordings are handled.
        </p>
      </Part>

      <Part id="terms-availability" title="Availability">
        <p>
          We work to keep the site available, but we can't promise it will never be interrupted.
          Work you submit while offline is sent when your connection returns. We may change or
          improve the site over time.
        </p>
      </Part>

      <Part id="terms-suspension" title="Suspending an account">
        <p>
          The college may suspend or close an account that breaks these terms or the college's
          policies, or to protect other users or the service.
        </p>
      </Part>

      <Part id="terms-liability" title="Our responsibility">
        <p>
          We provide the site as it is. To the extent the law allows, the college isn't responsible
          for losses caused by interruptions, or by things outside its reasonable control. Nothing
          in these terms limits rights you have by law.
        </p>
      </Part>

      <Part id="terms-law" title="The law that applies">
        <p>These terms are governed by the laws of the Federal Republic of Nigeria.</p>
      </Part>

      <Part id="terms-changes" title="Changes and contact">
        <p>
          We may update these terms, and we'll change the date at the top when we do. If a change
          matters to you, we'll tell you before it applies. Questions: <Contact />.
        </p>
      </Part>
    </LegalPage>
  );
}
