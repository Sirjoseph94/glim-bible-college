import type { admissions, ReviewedApplication } from "@glim/contracts";
import { BackLink } from "../components/app/back-link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { STATUS_LABEL } from "../api/applications";
import { api } from "../api/client";
import { Alert } from "../components/form";
import { CalendarDate, Time } from "../components/time";
import { useSubmit } from "../components/use-submit";

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
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-slate-600">{term}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
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

  if (detail.isPending) return <div className="h-48 animate-pulse rounded bg-slate-200" />;
  if (detail.isError) return <Alert tone="error">We couldn't load this application.</Alert>;
  const a = detail.data;
  const update = (next: ReviewedApplication) => {
    queryClient.setQueryData(detailKey(applicationId), next);
    void queryClient.invalidateQueries({ queryKey: ["admissions", "queue"] });
  };

  return (
    <div className="space-y-4">
      <BackLink to="/admissions" label="All applications" />
      <div>
        <h1 className="text-title">
          {[a.personal.firstName, a.personal.middleName, a.personal.lastName]
            .filter(Boolean)
            .join(" ")}
        </h1>
        <p className="text-sm text-slate-600">
          {a.referenceNo} · {a.programme.name} ·{" "}
          {a.studyMode === "ON_CAMPUS" ? "On campus" : "Online"} · {a.intake.academicSessionName}
        </p>
        <p className="mt-1">
          Status: <strong>{STATUS_LABEL[a.status]}</strong>
        </p>
      </div>

      <Decision application={a} onChange={update} />

      {a.photo ? (
        <img
          src={a.photo.downloadPath}
          alt="Applicant's passport photo"
          // eslint-disable-next-line glim/design-tokens -- design-exception: geometry, passport-photo aspect ratio
          className="h-48 w-[149px] rounded border border-slate-200 object-cover"
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
                <span className="text-amber-700">{a.referral.code}: not recognised</span>
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
        <ol className="space-y-1 text-sm">
          {a.timeline.map((e) => (
            <li key={`${e.status}-${e.at}`}>
              {STATUS_LABEL[e.status]} · <Time value={e.at} />
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
  const { busy, error, run } = useSubmit();
  const [note, setNote] = useState("");
  return (
    <Section title="Internal notes">
      <p className="text-sm text-slate-600">Only Admissions staff see these.</p>
      <ul className="space-y-2 text-sm">
        {application.notes.map((n) => (
          <li key={n.id} className="rounded bg-slate-50 p-2">
            <p className="whitespace-pre-wrap">{n.note}</p>
            <p className="text-slate-500">
              {n.by ?? "Unknown"} · <Time value={n.at} />
            </p>
          </li>
        ))}
      </ul>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form
        className="space-y-2"
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
        <label htmlFor="note" className="block text-sm font-medium text-slate-700">
          Add a note (e.g. from an interview)
        </label>
        <textarea
          id="note"
          rows={3}
          required
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
          className="block w-full rounded border border-slate-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded border border-slate-300 bg-white px-3 py-1"
        >
          Add note
        </button>
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
  const { busy, error, run } = useSubmit();
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

  return (
    <Section title="Decision">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <label htmlFor="decision-note" className="block text-sm font-medium text-slate-700">
        Internal note (never sent to the applicant)
      </label>
      <textarea
        id="decision-note"
        rows={2}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        className="block w-full rounded border border-slate-300 px-3 py-2"
      />
      {choice === null ? (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setChoice("ADMIT");
            }}
            className="rounded bg-brand px-4 py-2 font-medium text-white"
          >
            Admit
          </button>
          <button
            type="button"
            onClick={() => {
              setChoice("REJECT");
            }}
            className="rounded border border-red-300 bg-white px-4 py-2 text-red-700"
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="space-y-2 rounded border border-slate-300 bg-slate-50 p-3 text-sm">
          <p>
            {choice === "ADMIT"
              ? "Admit this applicant? They'll be emailed an offer to accept within the intake's deadline."
              : "Reject this application? The applicant will be emailed a neutral letter."}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
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
                })
              }
              className="rounded bg-brand px-3 py-1 font-medium text-white"
            >
              {choice === "ADMIT" ? "Yes, admit" : "Yes, reject"}
            </button>
            <button
              type="button"
              onClick={() => {
                setChoice(null);
              }}
              className="underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
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
  const { busy, error, run } = useSubmit();
  const [reason, setReason] = useState("");
  return (
    <Section title="Offer lapsed">
      <p className="text-sm text-slate-600">
        The offer wasn't accepted by <Time value={application.decision.offerExpiresAt} />. Reopening
        gives the applicant a new deadline and emails them the offer again.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            onChange(
              await api<typeof admissions.reopenOffer>(
                "POST",
                "/admissions/applications/:id/reopen-offer",
                { params: { id: application.id }, body: { reason } },
              ),
            );
          });
        }}
      >
        <label htmlFor="reopen-reason" className="block text-sm font-medium text-slate-700">
          Reason for reopening
        </label>
        <textarea
          id="reopen-reason"
          rows={2}
          required
          minLength={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
          className="block w-full rounded border border-slate-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-brand px-4 py-2 font-medium text-white"
        >
          Reopen offer
        </button>
      </form>
    </Section>
  );
}
