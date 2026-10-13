import type { admissions, ReviewedApplication } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { STATUS_LABEL } from "../api/applications";
import { api } from "../api/client";
import { BackLink } from "../components/app/back-link";
import { PageHeader } from "../components/app/page-header";
import { isNotAvailable, LoadFailed, NotAvailable } from "../components/app/page-states";
import { CalendarDate, Time } from "../components/time";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/dialog";
import { TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";
import { ApplicationStatusBadge } from "./application";

const LABELS: Record<string, string> = {
  MR: "Mr",
  MRS: "Mrs",
  PASTOR: "Pastor",
  REV: "Rev",
  DR: "Dr",
  OTHER: "Other",
  MALE: "Male",
  FEMALE: "Female",
  SINGLE: "Single",
  MARRIED: "Married",
  SINGLE_PARENT: "Single parent",
  WIDOWED: "Widowed",
  SEPARATED: "Separated",
  DIVORCED: "Divorced",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  EMAIL: "Email",
  SMS: "SMS",
  BILLBOARD: "Billboard",
  FLYER: "Flyer",
  FRIEND: "A friend",
  STUDENT: "A student",
  ALUMNI: "An alumnus",
  STAFF: "A member of staff",
  BABIC_CONFERENCE: "BABIC Conference",
  NCGC_MEMBER: "NCGC member",
};
const label = (v: string | null) => (v === null ? null : (LABELS[v] ?? v));
const yesNo = (v: boolean | null) => (v === null ? null : v ? "Yes" : "No");

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    // eslint-disable-next-line glim/design-tokens -- design-exception: geometry, label column width
    <dl className="grid gap-x-4 gap-y-2 text-body-sm sm:grid-cols-[12rem_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-ink-muted">{term}</dt>
          <dd className="text-ink">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="space-y-3">
      <h2 className="text-heading">{title}</h2>
      {children}
    </Card>
  );
}

const detailKey = (id: string) => ["admissions", "application", id];

/** One application for Admissions staff (TRD §10.3; spec stories 30–33, 35–36). */
export function AdmissionsApplicationPage() {
  const { applicationId } = useParams({ from: "/admissions/applications/$applicationId" });
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: detailKey(applicationId),
    queryFn: ({ signal }) =>
      api<typeof admissions.getReviewedApplication>("GET", "/admissions/applications/:id", {
        params: { id: applicationId },
        signal,
      }),
  });

  // Opening a submitted application marks it Under Review (spec story 31).
  const status = detail.data?.status;
  useEffect(() => {
    if (status !== "SUBMITTED") return;
    void api<typeof admissions.startReview>("POST", "/admissions/applications/:id/review", {
      params: { id: applicationId },
    }).then((reviewed) => {
      queryClient.setQueryData(detailKey(applicationId), reviewed);
    });
  }, [status, applicationId, queryClient]);

  if (detail.isPending)
    return (
      <SkeletonGroup label="Loading the application">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </SkeletonGroup>
    );
  if (detail.isError)
    return isNotAvailable(detail.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="this application" onRetry={() => void detail.refetch()} />
    );
  const a = detail.data;
  const update = (next: ReviewedApplication) => {
    queryClient.setQueryData(detailKey(applicationId), next);
    void queryClient.invalidateQueries({ queryKey: ["admissions", "queue"] });
  };

  return (
    <div className="space-y-5">
      <BackLink to="/admissions" label="All applications" />
      <div className="space-y-2">
        <PageHeader
          title={[a.personal.firstName, a.personal.middleName, a.personal.lastName]
            .filter(Boolean)
            .join(" ")}
          meta={`${a.referenceNo ?? ""} · ${a.programme.name} · ${a.studyMode === "ON_CAMPUS" ? "On campus" : "Online"} · ${a.intake.academicSessionName}`}
        />
        <p className="text-body">
          Status: <ApplicationStatusBadge status={a.status} />
        </p>
      </div>

      <Decision application={a} onChange={update} />

      {a.photo ? (
        <img
          src={a.photo.downloadPath}
          alt="Applicant's passport photo"
          // eslint-disable-next-line glim/design-tokens -- design-exception: geometry, passport-photo aspect ratio
          className="h-48 w-[149px] rounded-md border border-line object-cover"
        />
      ) : null}

      <Section title="1. Personal information">
        <Rows
          rows={[
            [
              "Title",
              a.personal.title === "OTHER" ? a.personal.titleOther : label(a.personal.title),
            ],
            ["Gender", label(a.personal.gender)],
            ["Date of birth", <CalendarDate key="dob" value={a.personal.dateOfBirth} />],
            ["Marital status", label(a.personal.maritalStatus)],
            ["Nationality", a.personal.nationality],
            ["Present occupation", a.personal.occupation],
          ]}
        />
      </Section>
      <Section title="2. Contact information">
        <Rows
          rows={[
            ["Email", a.contact.email],
            ["Mobile phone (WhatsApp)", a.contact.phoneWhatsapp],
            ["Alternative phone", a.contact.altPhoneWhatsapp],
            ["Account", `${a.applicant.displayName} (${a.applicant.accountEmail})`],
          ]}
        />
      </Section>
      <Section title="3. Address">
        <Rows
          rows={[
            ["Country of residence", a.address.country],
            ["State or province", a.address.stateProvince],
            ["City", a.address.city],
            ["Post code", a.address.postcode],
            ["Address", a.address.address],
          ]}
        />
      </Section>
      <Section title="4. Church">
        <Rows
          rows={[
            ["Church", a.church.churchName],
            ["Church address", a.church.churchAddress],
            ["Pastor", a.church.pastorName],
            ["Pastor's phone", a.church.pastorPhone],
          ]}
        />
      </Section>
      {/* Only sent to staff who may read it (INV-15); absent otherwise, so nothing to mask here. */}
      {a.spiritual ? (
        <Section title="5. Spiritual background (confidential)">
          <Rows
            rows={[
              ["Born again", yesNo(a.spiritual.bornAgain)],
              ["When", a.spiritual.bornAgainWhen],
              ["Water baptism by immersion", a.spiritual.waterBaptism],
              ["Holy Spirit baptism (tongues)", yesNo(a.spiritual.holySpiritBaptism)],
              ["Since when", a.spiritual.holySpiritSince],
            ]}
          />
        </Section>
      ) : null}
      <Section title="6. How they heard about us">
        <Rows
          rows={[
            [
              "Heard via",
              a.feedback.heardVia
                .map((v) => (v === "OTHER" ? a.feedback.heardViaOther : label(v)))
                .join(", "),
            ],
            [
              "Referral code",
              a.referral === null ? null : a.referral.matched ? (
                `${a.referral.code} (${a.referral.referrerName ?? "matched"})`
              ) : (
                <span className="text-warning">{a.referral.code}: not recognised</span>
              ),
            ],
          ]}
        />
      </Section>
      <Section title="7–8. Declaration and consent">
        <Rows
          rows={[
            ["Signed as", a.declaration.fullName],
            ["Statement of Faith read", yesNo(a.declaration.statementOfFaithRead)],
            ["Declared", <Time key="declared" value={a.declaration.declaredAt} />],
            ["Data consent", <Time key="consent" value={a.consent.consentedAt} />],
          ]}
        />
      </Section>

      <Notes application={a} onChange={update} />

      <Section title="History">
        <ol className="space-y-2 border-l-2 border-line pl-4 text-body-sm">
          {a.timeline.map((e) => (
            <li key={`${e.status}-${e.at}`}>
              <strong>{STATUS_LABEL[e.status]}</strong>
              <span className="text-ink-muted">
                {" "}
                · <Time value={e.at} />
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

function Notes({
  application,
  onChange,
}: {
  application: ReviewedApplication;
  onChange: (next: ReviewedApplication) => void;
}) {
  const { busy, problem, run } = useSubmit();
  const [note, setNote] = useState("");
  return (
    <Section title="Internal notes">
      <p className="text-body-sm text-ink-muted">Only Admissions staff see these.</p>
      {application.notes.length === 0 ? null : (
        <ul className="space-y-2 text-body-sm">
          {application.notes.map((n) => (
            <li key={n.id} className="space-y-1 rounded-md bg-surface-sunken p-3">
              <p className="whitespace-pre-wrap text-ink">{n.note}</p>
              <p className="text-meta text-ink-muted">
                {n.by ?? "Unknown"} · <Time value={n.at} />
              </p>
            </li>
          ))}
        </ul>
      )}
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            onChange(
              await api<typeof admissions.addApplicationNote>(
                "POST",
                "/admissions/applications/:id/notes",
                { params: { id: application.id }, body: { note } },
              ),
            );
            setNote("");
          });
        }}
      >
        <TextField
          id="note"
          label="Add a note (e.g. from an interview)"
          multiline
          rows={3}
          required
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
        <Button type="submit" variant="secondary" loading={busy}>
          Add note
        </Button>
      </form>
    </Section>
  );
}

function Decision({
  application,
  onChange,
}: {
  application: ReviewedApplication;
  onChange: (next: ReviewedApplication) => void;
}) {
  const [choice, setChoice] = useState<"ADMIT" | "REJECT" | null>(null);
  const [note, setNote] = useState("");
  // One key per decision attempt, so a retried request can't decide twice.
  const key = useRef(crypto.randomUUID());

  if (application.decision.decidedAt !== null && application.status !== "LAPSED")
    return (
      <Section title="Decision">
        <Rows
          rows={[
            ["Decision", STATUS_LABEL[application.status]],
            ["Decided", <Time key="at" value={application.decision.decidedAt} />],
            ["By", application.decision.by],
            ["Internal note", application.decision.note],
            ...(application.decision.offerExpiresAt === null
              ? []
              : ([
                  ["Offer expires", <Time key="exp" value={application.decision.offerExpiresAt} />],
                ] as [string, ReactNode][])),
          ]}
        />
      </Section>
    );
  if (application.status === "LAPSED")
    return <Reopen application={application} onChange={onChange} />;
  if (application.status !== "UNDER_REVIEW") return null;

  // ConfirmDialog shows a failure itself, so the request's error is left to throw.
  const decide = async () => {
    if (choice === null) return;
    onChange(
      await api<typeof admissions.decideApplication>(
        "POST",
        "/admissions/applications/:id/decide",
        {
          params: { id: application.id },
          headers: { "idempotency-key": key.current },
          body: { decision: choice, ...(note.trim() === "" ? {} : { note }) },
        },
      ),
    );
    key.current = crypto.randomUUID();
    setChoice(null);
  };

  return (
    <Section title="Decision">
      <TextField
        id="decision-note"
        label="Internal note (never sent to the applicant)"
        multiline
        rows={2}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
      />
      <div className="flex flex-col gap-2 md:flex-row">
        <Button
          variant="primary"
          onClick={() => {
            setChoice("ADMIT");
          }}
        >
          Admit
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            setChoice("REJECT");
          }}
        >
          Reject
        </Button>
      </div>
      <ConfirmDialog
        open={choice !== null}
        onOpenChange={(open) => {
          if (!open) setChoice(null);
        }}
        title={choice === "REJECT" ? "Reject this application?" : "Admit this applicant?"}
        confirmLabel={choice === "REJECT" ? "Reject application" : "Admit applicant"}
        tone={choice === "REJECT" ? "danger" : "primary"}
        onConfirm={decide}
      >
        {choice === "REJECT"
          ? "The applicant will be emailed a neutral letter, without your internal note. The decision can't be changed afterwards."
          : "The applicant will be emailed an offer to accept within the intake's acceptance period, counted from today. Your internal note isn't sent."}
      </ConfirmDialog>
    </Section>
  );
}

/** Reopening a lapsed offer (spec story 34): a new deadline, with the reason kept as a note. */
function Reopen({
  application,
  onChange,
}: {
  application: ReviewedApplication;
  onChange: (next: ReviewedApplication) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Section title="Offer lapsed">
      <p className="text-body-sm text-ink-muted">
        The offer wasn't accepted by <Time value={application.decision.offerExpiresAt} />. Reopening
        gives the applicant a new deadline and emails them the offer again.
      </p>
      <Button
        variant="primary"
        onClick={() => {
          setConfirming(true);
        }}
      >
        Reopen offer
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Reopen this offer?"
        confirmLabel="Reopen offer"
        reason={{ label: "Reason for reopening", minLength: 3 }}
        onConfirm={async (reason) => {
          onChange(
            await api<typeof admissions.reopenOffer>(
              "POST",
              "/admissions/applications/:id/reopen-offer",
              { params: { id: application.id }, body: { reason } },
            ),
          );
          setConfirming(false);
        }}
      >
        The applicant gets a new deadline and is emailed the offer again. Your reason is kept with
        the application as an internal note.
      </ConfirmDialog>
    </Section>
  );
}
