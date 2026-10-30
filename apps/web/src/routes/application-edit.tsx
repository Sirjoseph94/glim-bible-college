import type { Application, ApplicationSection, applications } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { applicationQuery, ENDED, mineQuery } from "../api/applications";
import { api, ApiError } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { preparePassportPhoto, uploadPassportPhoto } from "../components/passport-photo";
import { CalendarDate } from "../components/time";
import { Banner } from "../components/ui/banner";
import { Button, buttonClass } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox, Radio } from "../components/ui/choice";
import { Select, TextField } from "../components/ui/field";
import { ProgressBar } from "../components/ui/progress-bar";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";
import { Icon } from "../design/icons";
import { currentIntakeQuery, PROGRAMME_SHAPE } from "../api/intake";

/** Autosave interval (TRD §10.2: every 5–10 s). */
const AUTOSAVE_MS = 5000;

type Value = string | boolean | null | string[];
type Values = Record<ApplicationSection, Record<string, Value>>;

interface FieldDef {
  name: string;
  label: string;
  kind:
    | "text"
    | "textarea"
    | "date"
    | "email"
    | "tel"
    | "select"
    | "yesno"
    | "check"
    | "multi"
    | "photo";
  options?: readonly (readonly [string, string])[];
  hint?: string;
  /** Shown only when this returns true for the section's current answers. */
  when?: (v: Record<string, Value>) => boolean;
}

const HEARD_VIA = [
  ["FACEBOOK", "Facebook"],
  ["INSTAGRAM", "Instagram"],
  ["EMAIL", "Email"],
  ["SMS", "SMS"],
  ["BILLBOARD", "Billboard"],
  ["FLYER", "Flyer"],
  ["FRIEND", "A friend"],
  ["STUDENT", "A student"],
  ["ALUMNI", "An alumnus"],
  ["STAFF", "A member of staff"],
  ["BABIC_CONFERENCE", "BABIC Conference"],
  ["NCGC_MEMBER", "NCGC member"],
  ["OTHER", "Other"],
] as const;

/** The sections of the paper form, in order (TRD §10.2). */
const SECTIONS: { key: ApplicationSection; title: string; fields: FieldDef[] }[] = [
  {
    key: "personal",
    title: "Personal information",
    fields: [
      { name: "firstName", label: "First name", kind: "text" },
      { name: "middleName", label: "Middle name (optional)", kind: "text" },
      { name: "lastName", label: "Last name", kind: "text" },
      {
        name: "title",
        label: "Title",
        kind: "select",
        options: [
          ["MR", "Mr"],
          ["MRS", "Mrs"],
          ["PASTOR", "Pastor"],
          ["REV", "Rev"],
          ["DR", "Dr"],
          ["OTHER", "Other"],
        ],
      },
      { name: "titleOther", label: "Your title", kind: "text", when: (v) => v.title === "OTHER" },
      {
        name: "gender",
        label: "Gender",
        kind: "select",
        options: [
          ["MALE", "Male"],
          ["FEMALE", "Female"],
        ],
      },
      { name: "dateOfBirth", label: "Date of birth", kind: "date" },
      {
        name: "maritalStatus",
        label: "Marital status",
        kind: "select",
        options: [
          ["SINGLE", "Single"],
          ["MARRIED", "Married"],
          ["SINGLE_PARENT", "Single parent"],
          ["WIDOWED", "Widowed"],
          ["SEPARATED", "Separated"],
          ["DIVORCED", "Divorced"],
        ],
      },
      { name: "nationality", label: "Nationality", kind: "text" },
      { name: "occupation", label: "Present occupation", kind: "text" },
    ],
  },
  {
    key: "contact",
    title: "Contact information",
    fields: [
      { name: "email", label: "Email", kind: "email", hint: "We'll write to you at this address." },
      { name: "phoneWhatsapp", label: "Mobile phone (WhatsApp)", kind: "tel" },
      {
        name: "altPhoneWhatsapp",
        label: "Alternative phone (WhatsApp, optional)",
        kind: "tel",
      },
    ],
  },
  {
    key: "address",
    title: "Address",
    fields: [
      { name: "country", label: "Country of residence", kind: "text" },
      { name: "stateProvince", label: "State or province", kind: "text" },
      { name: "city", label: "City", kind: "text" },
      { name: "postcode", label: "Post code (optional)", kind: "text" },
      { name: "address", label: "Address", kind: "textarea" },
    ],
  },
  {
    key: "church",
    title: "Church",
    fields: [
      { name: "churchName", label: "Church name", kind: "text" },
      { name: "churchAddress", label: "Church address", kind: "textarea" },
      { name: "pastorName", label: "Pastor's name", kind: "text" },
      { name: "pastorPhone", label: "Pastor's phone", kind: "tel" },
    ],
  },
  {
    key: "spiritual",
    title: "Spiritual background",
    fields: [
      { name: "bornAgain", label: "Are you born again?", kind: "yesno" },
      { name: "bornAgainWhen", label: "When?", kind: "text", when: (v) => v.bornAgain === true },
      {
        name: "waterBaptism",
        label: "Have you been baptised in water by immersion?",
        kind: "textarea",
      },
      {
        name: "holySpiritBaptism",
        label:
          "Have you been baptised in the Holy Spirit with the evidence of speaking in tongues?",
        kind: "yesno",
      },
      {
        name: "holySpiritSince",
        label: "Since when?",
        kind: "text",
        when: (v) => v.holySpiritBaptism === true,
      },
    ],
  },
  {
    key: "feedback",
    title: "How you heard about us",
    fields: [
      { name: "heardVia", label: "How did you hear about us?", kind: "multi", options: HEARD_VIA },
      {
        name: "heardViaOther",
        label: "Where else did you hear about us?",
        kind: "text",
        when: (v) => Array.isArray(v.heardVia) && v.heardVia.includes("OTHER"),
      },
      { name: "referralCode", label: "Referral code (optional)", kind: "text" },
    ],
  },
  {
    key: "declaration",
    title: "Declaration",
    fields: [
      { name: "fullName", label: "Type your full name to sign", kind: "text" },
      {
        name: "statementOfFaithRead",
        label: "I have read the GLIM Online Bible College Statement of Faith in its entirety",
        kind: "check",
      },
      { name: "declared", label: "I make the declaration above", kind: "check" },
    ],
  },
  {
    key: "consent",
    title: "Data processing consent",
    fields: [{ name: "consented", label: "I give the consent above", kind: "check" }],
  },
  {
    key: "photo",
    title: "Passport photo",
    fields: [{ name: "fileId", label: "Passport photo", kind: "photo" }],
  },
];

/** The step after the last section: review what's missing, then submit. */
const REVIEW = SECTIONS.length;

const text = (v: string | null) => v ?? "";

/** The form's answers as the wizard edits them. */
function toValues(a: Application): Values {
  const strings = (o: Record<string, string | null>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, text(v)]));
  return {
    personal: strings(a.personal),
    contact: strings(a.contact),
    address: strings(a.address),
    church: strings(a.church),
    spiritual: {
      bornAgain: a.spiritual.bornAgain,
      bornAgainWhen: text(a.spiritual.bornAgainWhen),
      waterBaptism: text(a.spiritual.waterBaptism),
      holySpiritBaptism: a.spiritual.holySpiritBaptism,
      holySpiritSince: text(a.spiritual.holySpiritSince),
    },
    feedback: {
      heardVia: a.feedback.heardVia,
      heardViaOther: text(a.feedback.heardViaOther),
      referralCode: text(a.feedback.referralCode),
    },
    declaration: {
      fullName: text(a.declaration.fullName),
      statementOfFaithRead: a.declaration.statementOfFaithRead,
      declared: a.declaration.declaredAt !== null,
    },
    consent: { consented: a.consent.consentedAt !== null },
    photo: { fileId: a.photo?.fileId ?? null },
  };
}

/** One section's answers as the API takes them: an empty answer is "not answered yet". */
function toBody(values: Record<string, Value>): Record<string, Value> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === "" ? null : v]));
}

/** The applicant's application wizard (TRD §10.2; spec stories 4–11, 13–16). */
export function ApplicationEditPage() {
  const mine = useQuery(mineQuery);
  if (mine.isPending) return <Loading />;
  if (mine.isError)
    return <LoadFailed what="your application" onRetry={() => void mine.refetch()} />;
  const draft = mine.data.items.find((a) => a.status === "DRAFT");
  if (draft !== undefined) return <LoadApplication id={draft.id} />;
  // A submitted application can't be edited; after one ends, the applicant may start again.
  if (mine.data.items.some((a) => !ENDED.includes(a.status))) return <Navigate to="/application" />;
  return <StartApplication />;
}

function Loading() {
  return (
    <SkeletonGroup label="Loading your application">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-64" />
    </SkeletonGroup>
  );
}

function StartApplication() {
  const intake = useQuery(currentIntakeQuery);
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  if (intake.isPending) return <Loading />;
  if (intake.isError)
    return <LoadFailed what="the admissions information" onRetry={() => void intake.refetch()} />;
  if (intake.data.intake?.status !== "OPEN")
    return (
      <div className="space-y-5">
        <PageHeader title="Start your application" />
        <Banner
          tone="warning"
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/apply">See when they open</Link>
            </Button>
          }
        >
          Applications aren't open at the moment. The apply page shows when they open.
        </Banner>
      </div>
    );
  const { intake: open, programmes } = intake.data;
  // One programme (ADR-0005): applicants don't choose it, they're told it.
  const programme = programmes[0];

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(async () => {
          await api<typeof applications.startApplication>("POST", "/applications", {
            body: { studyMode: form.get("studyMode") },
          });
          await queryClient.invalidateQueries({ queryKey: ["applications"] });
          await queryClient.invalidateQueries({ queryKey: ["me"] });
        });
      }}
    >
      <PageHeader
        title="Start your application"
        meta={
          <>
            For the {open.code} Intake, starting on <CalendarDate value={open.startsOn} />.
            Applications close on <CalendarDate value={open.closesOn} />.
          </>
        }
      />
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      <Card className="space-y-5">
        {programme === undefined ? null : (
          <div className="space-y-1">
            <p className="text-label text-ink">Programme</p>
            <p className="text-body text-ink">{programme.name}</p>
            <p className="text-body-sm text-ink-muted">{PROGRAMME_SHAPE}</p>
          </div>
        )}
        <fieldset>
          <legend className="text-label text-ink">Study mode</legend>
          <Radio name="studyMode" value="ON_CAMPUS" required label="On campus" />
          <Radio name="studyMode" value="ONLINE" required label="Online" />
        </fieldset>
      </Card>
      <Button type="submit" variant="primary" block loading={busy}>
        Start my application
      </Button>
    </form>
  );
}

function LoadApplication({ id }: { id: string }) {
  const application = useQuery({
    ...applicationQuery(id),
    // The wizard owns the draft once loaded; refetching would fight the autosave.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (application.isPending) return <Loading />;
  if (application.isError)
    return <LoadFailed what="your application" onRetry={() => void application.refetch()} />;
  return <Wizard initial={application.data} />;
}

type SaveState = "saved" | "pending" | "saving" | "offline" | "invalid" | "conflict";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  pending: "Unsaved changes",
  saving: "Saving…",
  offline: "Offline — will retry",
  invalid: "Not saved — check the answers marked below",
  conflict: "Not saved",
};

function Wizard({ initial }: { initial: Application }) {
  const [application, setApplication] = useState(initial);
  const [values, setValues] = useState(() => toValues(initial));
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Resume where the applicant left off: the first section with something still to answer.
  const [step, setStep] = useState(() => {
    const unfinished = SECTIONS.findIndex((s) => initial.missing[s.key].length > 0);
    return unfinished === -1 ? REVIEW : unfinished;
  });

  const valuesRef = useRef(values);
  const version = useRef(initial.version);
  const dirty = useRef(new Set<ApplicationSection>());
  const edits = useRef(0);
  const inFlight = useRef(false);
  // A save the server refused (bad answer, or changed elsewhere) isn't retried until the next edit.
  const held = useRef(false);

  const save = useCallback(async () => {
    if (inFlight.current || held.current || dirty.current.size === 0) return;
    inFlight.current = true;
    const sections = [...dirty.current];
    const sentAt = edits.current;
    setSaveState("saving");
    try {
      const next = await api<typeof applications.saveApplicationDraft>(
        "PATCH",
        "/applications/:id",
        {
          params: { id: initial.id },
          headers: { "if-match": `"${String(version.current)}"` },
          body: Object.fromEntries(sections.map((s) => [s, toBody(valuesRef.current[s])])),
        },
      );
      version.current = next.version;
      setApplication(next);
      setErrors({});
      if (edits.current === sentAt) {
        dirty.current.clear();
        setSaveState("saved");
      } else setSaveState("pending");
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        held.current = true;
        setSaveState("conflict");
      } else if (error instanceof ApiError && error.status < 500) {
        held.current = true;
        setErrors(error.fieldErrors);
        setSaveState("invalid");
      } else setSaveState("offline");
    } finally {
      inFlight.current = false;
    }
  }, [initial.id]);

  useEffect(() => {
    const timer = setInterval(() => void save(), AUTOSAVE_MS);
    const flush = () => void save();
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", flush);
    };
  }, [save]);

  const change = (section: ApplicationSection, name: string, value: Value) => {
    const next = {
      ...valuesRef.current,
      [section]: { ...valuesRef.current[section], [name]: value },
    };
    valuesRef.current = next;
    setValues(next);
    dirty.current.add(section);
    edits.current++;
    if (saveState !== "conflict") {
      held.current = false;
      setSaveState("pending");
    }
    // A new photo is saved at once rather than at the next autosave tick.
    if (section === "photo") void save();
  };

  const go = (to: number) => {
    void save();
    setStep(to);
    window.scrollTo({ top: 0 });
  };

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // One key per submission attempt, reused on retry, so a lost response can't submit twice.
  const submitKey = useRef(crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      for (let i = 0; i < 20 && (inFlight.current || dirty.current.size > 0); i++) {
        await save();
        if (inFlight.current) await new Promise((resolve) => setTimeout(resolve, 250));
        if (held.current) break;
      }
      if (dirty.current.size > 0) {
        setSubmitError("Your latest answers haven't been saved yet. Check them, then try again.");
        return;
      }
      const submitted = await api<typeof applications.submitApplication>(
        "POST",
        "/applications/:id/submit",
        { params: { id: initial.id }, headers: { "idempotency-key": submitKey.current } },
      );
      queryClient.setQueryData(applicationQuery(initial.id).queryKey, submitted);
      await queryClient.invalidateQueries({ queryKey: ["applications", "mine"] });
      await navigate({ to: "/application" });
    } catch (error) {
      if (error instanceof ApiError) {
        setSubmitError(error.message);
        if (error.code === "APPLICATION_INCOMPLETE") {
          setApplication(
            await api<typeof applications.getApplication>("GET", "/applications/:id", {
              params: { id: initial.id },
            }),
          );
        }
      } else {
        setSubmitError(
          "We couldn't reach the server. Your answers are saved; try submitting again.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const section = SECTIONS[step];
  const done = SECTIONS.filter((s) => application.missing[s.key].length === 0).length;
  const gaps = SECTIONS.some((s) => application.missing[s.key].length > 0);
  const intakeOpen = application.intake.status === "OPEN";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Your application"
        meta={`${application.programme.name} · ${application.studyMode === "ON_CAMPUS" ? "On campus" : "Online"} · ${application.intake.code} Intake`}
      />
      {saveState === "conflict" ? (
        <Banner
          tone="danger"
          title="Your application was changed in another window or tab"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                window.location.reload();
              }}
            >
              Reload
            </Button>
          }
        >
          Reload to carry on from the latest version.
        </Banner>
      ) : null}

      <nav aria-label="Sections" className="space-y-2">
        <p className="text-body-sm text-ink-muted">
          {done} of {SECTIONS.length} sections complete
        </p>
        <ol className="flex flex-wrap gap-2">
          {SECTIONS.map((s, index) => {
            const complete = application.missing[s.key].length === 0;
            return (
              <li key={s.key}>
                <Button
                  size="sm"
                  variant={index === step ? "primary" : "secondary"}
                  aria-current={index === step ? "step" : undefined}
                  onClick={() => {
                    go(index);
                  }}
                >
                  {index + 1}. {s.title}
                  {complete ? (
                    <>
                      <Icon name="check" size={16} />
                      <span className="sr-only"> (complete)</span>
                    </>
                  ) : null}
                </Button>
              </li>
            );
          })}
          <li>
            <Button
              size="sm"
              variant={step === REVIEW ? "primary" : "secondary"}
              aria-current={step === REVIEW ? "step" : undefined}
              onClick={() => {
                go(REVIEW);
              }}
            >
              Review and submit
            </Button>
          </li>
        </ol>
      </nav>

      {section === undefined ? (
        <Review application={application} onGo={go} error={submitError} />
      ) : (
        <Card className="space-y-4">
          <h2 className="text-heading">
            {step + 1}. {section.title}
          </h2>
          <SectionIntro section={section.key} application={application} />
          {section.fields
            .filter((f) => f.when?.(values[section.key]) ?? true)
            .map((field) => (
              <FieldInput
                key={field.name}
                id={`${section.key}-${field.name}`}
                field={field}
                value={values[section.key][field.name] ?? null}
                error={errors[`${section.key}.${field.name}`]}
                onChange={(value) => {
                  change(section.key, field.name, value);
                }}
              />
            ))}
        </Card>
      )}

      {/* Save state and the way on: pinned to the bottom of the screen on phones. */}
      <div className="sticky bottom-0 z-nav -mx-4 space-y-2 border-t border-line bg-surface-raised px-4 pt-3 pb-5 shadow-sheet md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:shadow-none">
        <p
          role="status"
          aria-live="polite"
          className={
            saveState === "invalid" || saveState === "conflict"
              ? "text-body-sm text-danger"
              : "text-body-sm text-ink-muted"
          }
        >
          {SAVE_LABEL[saveState]}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon="chevronLeft"
            disabled={step === 0}
            onClick={() => {
              go(step - 1);
            }}
          >
            Back
          </Button>
          {step < REVIEW ? (
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => {
                go(step + 1);
              }}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="primary"
              className="flex-1"
              loading={submitting}
              // Disabled only while answers are missing or the intake has closed; the review
              // above says which.
              disabled={gaps || !intakeOpen}
              aria-describedby="review-reason"
              onClick={() => void submit()}
            >
              Submit application
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionIntro({
  section,
  application,
}: {
  section: ApplicationSection;
  application: Application;
}): ReactNode {
  switch (section) {
    case "personal":
      return (
        <p className="text-body-sm text-ink-muted">
          You must be at least {application.minimumAgeYears} on{" "}
          <CalendarDate value={application.intake.startsOn} />, when studies start.
        </p>
      );
    case "spiritual":
      return (
        <Banner tone="info">
          Only the Admissions Officers and the System Admin see your answers in this section.
        </Banner>
      );
    case "declaration":
      return (
        <div className="space-y-2 text-body-sm">
          <p className="rounded-md bg-surface-sunken p-3">{application.texts.declarationText}</p>
          {application.texts.statementOfFaithUrl ? (
            <p>
              <a
                href={application.texts.statementOfFaithUrl}
                className="text-brand underline"
                rel="noreferrer"
                target="_blank"
              >
                Read the Statement of Faith
              </a>{" "}
              (opens in a new tab).
            </p>
          ) : null}
        </div>
      );
    case "consent":
      return (
        <div className="space-y-2">
          <p className="rounded-md bg-surface-sunken p-3 text-body-sm">
            {application.texts.consentText}
          </p>
          <p className="text-body-sm text-ink-muted">
            Our{" "}
            <Link to="/privacy" className="text-brand underline">
              privacy policy
            </Link>{" "}
            explains how the college uses and protects your answers.
          </p>
        </div>
      );
    case "photo":
      return (
        <p className="text-body-sm text-ink-muted">
          A recent head-and-shoulders photo, as for a passport, with a plain background. We crop and
          shrink it on your phone before sending it, so it uploads quickly.
        </p>
      );
    default:
      return null;
  }
}

/** A refused answer under a group of choices, worded as the server sent it. */
function ChoiceError({ id, error }: { id: string; error: string | undefined }) {
  if (error === undefined) return null;
  return (
    <p id={`${id}-error`} className="flex items-start gap-1 text-body-sm text-danger">
      <span className="mt-0.5 shrink-0">
        <Icon name="alert" size={16} />
      </span>
      {error}
    </p>
  );
}

function FieldInput({
  id,
  field,
  value,
  error,
  onChange,
}: {
  id: string;
  field: FieldDef;
  value: Value;
  error: string | undefined;
  onChange: (value: Value) => void;
}) {
  const str = typeof value === "string" ? value : "";
  const described = error ? `${id}-error` : undefined;

  switch (field.kind) {
    case "textarea":
      return (
        <TextField
          id={id}
          label={field.label}
          hint={field.hint}
          error={error}
          multiline
          rows={3}
          value={str}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );
    case "select":
      return (
        <Select
          id={id}
          label={field.label}
          hint={field.hint}
          error={error}
          value={str}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        >
          <option value="">Choose…</option>
          {field.options?.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </Select>
      );
    case "yesno":
      return (
        <fieldset aria-describedby={described}>
          <legend className="text-label text-ink">{field.label}</legend>
          <div className="flex gap-6">
            {([true, false] as const).map((answer) => (
              <Radio
                key={String(answer)}
                name={id}
                label={answer ? "Yes" : "No"}
                checked={value === answer}
                onChange={() => {
                  onChange(answer);
                }}
              />
            ))}
          </div>
          <ChoiceError id={id} error={error} />
        </fieldset>
      );
    case "check":
      return (
        <div>
          <Checkbox
            id={id}
            label={field.label}
            aria-describedby={described}
            aria-invalid={error ? true : undefined}
            checked={value === true}
            onChange={(e) => {
              onChange(e.target.checked);
            }}
          />
          <ChoiceError id={id} error={error} />
        </div>
      );
    case "photo":
      return (
        <PhotoField id={id} fileId={typeof value === "string" ? value : null} onChange={onChange} />
      );
    case "multi": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <fieldset aria-describedby={described}>
          <legend className="text-label text-ink">{field.label}</legend>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {field.options?.map(([v, label]) => (
              <Checkbox
                key={v}
                label={label}
                checked={chosen.includes(v)}
                onChange={(e) => {
                  onChange(e.target.checked ? [...chosen, v] : chosen.filter((c) => c !== v));
                }}
              />
            ))}
          </div>
          <ChoiceError id={id} error={error} />
        </fieldset>
      );
    }
    default:
      return (
        <TextField
          id={id}
          label={field.label}
          hint={field.hint}
          error={error}
          type={field.kind}
          autoComplete={field.kind === "email" ? "email" : field.kind === "tel" ? "tel" : "off"}
          value={str}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );
  }
}

function PhotoField({
  id,
  fileId,
  onChange,
}: {
  id: string;
  fileId: string | null;
  onChange: (value: Value) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (preview !== null) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const src = preview ?? (fileId === null ? null : `/api/v1/files/${fileId}/download`);

  return (
    <div className="space-y-3">
      {src === null ? null : (
        <img
          src={src}
          alt="Your passport photo"
          // eslint-disable-next-line glim/design-tokens -- design-exception: geometry, passport-photo aspect ratio
          className="h-48 w-[149px] rounded-md border border-line object-cover"
        />
      )}
      <label
        htmlFor={id}
        className={`${buttonClass({ variant: "secondary" })} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus ${progress === null ? "" : "opacity-55"}`}
      >
        <Icon name="upload" />
        {src === null ? "Choose a photo" : "Choose a different photo"}
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          disabled={progress !== null}
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (file === undefined) return;
            setError(null);
            setProgress(0);
            void (async () => {
              try {
                const photo = await preparePassportPhoto(file);
                setPreview(URL.createObjectURL(photo));
                onChange(await uploadPassportPhoto(photo, setProgress));
              } catch (e) {
                setError(e instanceof Error ? e.message : "The photo couldn't be uploaded.");
              } finally {
                setProgress(null);
                input.value = "";
              }
            })();
          }}
        />
      </label>
      {progress === null ? null : <ProgressBar label="Uploading" value={progress * 100} />}
      {error === null ? null : (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The step after the last section: what's still missing, and whether it can be submitted. */
function Review({
  application,
  onGo,
  error,
}: {
  application: Application;
  onGo: (step: number) => void;
  error: string | null;
}) {
  const gaps = SECTIONS.map((section, index) => ({
    section,
    index,
    fields: application.missing[section.key],
  })).filter((gap) => gap.fields.length > 0);
  const label = (section: (typeof SECTIONS)[number], name: string) =>
    section.fields.find((f) => f.name === name)?.label ?? name;
  const open = application.intake.status === "OPEN";

  return (
    <Card className="space-y-4">
      <h2 className="text-heading">Review and submit</h2>
      <div id="review-reason" className="space-y-3">
        {open ? null : (
          <Banner tone="warning">
            Applications for the {application.intake.code} Intake have closed, so this
            application can't be submitted.
          </Banner>
        )}
        {gaps.length > 0 ? (
          <div className="space-y-2">
            <p className="text-body">These answers are still needed before you can submit:</p>
            <ul className="space-y-2">
              {gaps.map((gap) => (
                <li key={gap.section.key} className="text-body-sm">
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      onGo(gap.index);
                    }}
                  >
                    {gap.index + 1}. {gap.section.title}
                  </Button>
                  <span className="text-ink-muted">
                    {" "}
                    {gap.fields.map((f) => label(gap.section, f)).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-body">
            Everything's answered. Check your answers in each section, then submit. You can't change
            them after submitting.
          </p>
        )}
      </div>
      {error === null ? null : <Banner tone="danger">{error}</Banner>}
    </Card>
  );
}
