import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * The privacy policy, terms of service and contact page, public at /privacy, /terms and /contact. Every statement about
 * data follows docs/compliance/ropa.md and the code it cites (cookies, device storage, retention);
 * change them together. Legal review is a launch gate (TRD C-41).
 */
export const LEGAL_NAME = "GLIM Bible College";
export const LEGAL_CONTACT = "online@glimbiblecollege.com";
const UPDATED = "29 October 2026";

const LINK = "text-brand underline";

function LegalPage({
  title,
  meta = <p>Last updated {UPDATED}</p>,
  children,
}: {
  title: string;
  /** The lines under the title; the privacy policy's last-updated date unless given. */
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="space-y-6 pb-8">
      <header className="space-y-1">
        <h1 className="text-display">{title}</h1>
        <div className="space-y-0.5 text-body-sm text-ink-muted">{meta}</div>
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

      {/* Google API Services User Data Policy: what the openid/email/profile scopes give us and
          how it's used (google-sign-in.service.ts keeps the sub, email, name and hosted domain). */}
      <Part id="privacy-google" title="Signing in with Google">
        <p>
          If you sign in with Google, Google tells us your Google account ID, your email address
          (and that Google has verified it), your name and, for a Google Workspace account, its
          domain. We ask only for this basic profile; we get no access to your Gmail, Drive,
          contacts or anything else in your Google account, and we don't keep any Google access
          tokens.
        </p>
        <Bullets>
          <li>We use it only to sign you in and to match you to your account with the college.</li>
          <li>
            We don't sell it, share it with anyone else or use it for advertising, and no one reads
            it except to run and support the service.
          </li>
          <li>We keep it with your account, and delete it when your account is erased.</li>
          <li>
            You can remove the college's access at any time in your{" "}
            <a
              href="https://myaccount.google.com/connections"
              className={LINK}
              rel="noreferrer"
              target="_blank"
            >
              Google account's third-party connections
            </a>{" "}
            (opens in a new tab). You then can't sign in with Google until you allow it again. To
            have the information deleted, ask us to erase your account.
          </li>
        </Bullets>
        <p>
          The college's use of information received from Google APIs adheres to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className={LINK}
            rel="noreferrer"
            target="_blank"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
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

/** The owner's text (30 October 2026), with its numbering. */
export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      meta={
        <>
          <p>Effective Date: October 30, 2026</p>
          <p>Application / Service Name: GLIM Bible College Portal</p>
          <p>Domain: glimbiblecollege.com</p>
        </>
      }
    >
      <Part id="terms-acceptance" title="1. Acceptance of Terms">
        <p>
          By accessing or using the GLIM Bible College platform (&ldquo;Service&rdquo;), provided by
          GLIM Bible College (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;), you agree
          to be bound by these Terms of Service. If you do not agree to these terms, please do not
          use or access the Service.
        </p>
      </Part>

      <Part id="terms-description" title="2. Description of Service">
        <p>
          GLIM Bible College provides an educational management platform that enables students,
          faculty, and administrative staff to manage courses, track academic progress, access
          learning resources, and communicate effectively.
        </p>
      </Part>

      <Part id="terms-google" title="3. Third-Party Authentication & Google Integration">
        <p>
          Our Service allows users to log in using third-party authentication services, including
          Google OAuth.
        </p>
        <p>
          <strong>Authentication &amp; Permissions:</strong> When you choose to sign in using your
          Google Account, you authorize us to access specific profile information necessary for
          identity verification and account creation (such as your name and email address).
        </p>
        <p>
          <strong>Use of Google Data:</strong> Any user data accessed via Google APIs will be
          handled strictly in accordance with Google&rsquo;s{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className={LINK}
            rel="noreferrer"
            target="_blank"
          >
            API Services User Data Policy
          </a>{" "}
          and our{" "}
          <Link to="/privacy" className={LINK}>
            Privacy Policy
          </Link>
          .
        </p>
        <p>
          <strong>Scope Transparency:</strong> We only request access to the minimum required scopes
          necessary to authenticate your user identity and facilitate platform functionality. We do
          not sell, transfer, or misuse your Google account data.
        </p>
      </Part>

      <Part id="terms-accounts" title="4. User Accounts & Responsibilities">
        <p>
          <strong>Account Security:</strong> You are responsible for maintaining the confidentiality
          of your login credentials and for all activities that occur under your account.
        </p>
        <p>
          <strong>Accuracy of Information:</strong> You agree to provide accurate, current, and
          complete information during registration and to update such information as necessary.
        </p>
        <p>
          <strong>Prohibited Conduct:</strong> You agree not to misuse the Service, attempt
          unauthorized access to other user accounts, or upload unlawful or harmful content.
        </p>
      </Part>

      <Part id="terms-ip" title="5. Intellectual Property">
        <p>
          All content, branding, trademarks, course materials, and underlying software on
          glimbiblecollege.com are the property of GLIM Bible College or its licensors and are
          protected by applicable intellectual property laws.
        </p>
      </Part>

      <Part id="terms-termination" title="6. Termination of Service">
        <p>
          We reserve the right to suspend or terminate your access to the Service at our sole
          discretion, without prior notice, if you breach these Terms of Service or engage in
          activities that jeopardize the security or integrity of our systems.
        </p>
        <p>
          You may request account deletion at any time by contacting us at the support details
          provided below.
        </p>
      </Part>

      <Part id="terms-liability" title="7. Limitation of Liability">
        <p>
          To the maximum extent permitted by applicable law, GLIM Bible College shall not be liable
          for any indirect, incidental, special, consequential, or punitive damages resulting from
          your use of or inability to use the Service.
        </p>
      </Part>

      <Part id="terms-contact" title="8. Contact Us">
        <p>
          If you have any questions or concerns regarding these Terms of Service or our data
          handling practices, please contact us at:
        </p>
        <p>
          Email: <Contact />
        </p>
        <p>
          Website:{" "}
          <a href="https://glimbiblecollege.com/contact" className={LINK}>
            https://glimbiblecollege.com/contact
          </a>
        </p>
      </Part>
    </LegalPage>
  );
}

/** Where the terms send people (section 8). Only what the college has confirmed: no address yet. */
export function ContactPage() {
  return (
    <LegalPage title="Contact us" meta={<p>{LEGAL_NAME}</p>}>
      <Part id="contact-email" title="Email">
        <p>
          Write to <Contact /> with any question about the college, your account, your application
          or your studies.
        </p>
      </Part>

      <Part id="contact-apply" title="Applying">
        <p>
          The{" "}
          <Link to="/apply" className={LINK}>
            Apply
          </Link>{" "}
          page shows the current Intake, its Programmes and how to apply.
        </p>
      </Part>

      <Part id="contact-data" title="Your data and these terms">
        <p>
          To see, correct or erase the data the college holds about you, or with questions about our{" "}
          <Link to="/privacy" className={LINK}>
            Privacy Policy
          </Link>{" "}
          or{" "}
          <Link to="/terms" className={LINK}>
            Terms of Service
          </Link>
          , write to the same address.
        </p>
      </Part>
    </LegalPage>
  );
}
