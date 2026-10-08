import type { Application, ApplicationSection, applications } from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import { Alert, SubmitButton } from "../components/form";
import { CalendarDate } from "../components/time";
import { useSubmit } from "../components/use-submit";
import { currentIntakeQuery } from "./apply";

const mineQuery = queryOptions({
  queryKey: ["applications", "mine"],
  queryFn: ({ signal }) =>
    api<typeof applications.myApplications>("GET", "/applications/mine", { signal }),
});

/** Autosave interval (TRD §10.2: every 5–10 s). */
const AUTOSAVE_MS = 5000;

type Value = string | boolean | null | string[];
type Values = Record<ApplicationSection, Record<string, Value>>;

interface FieldDef {
  name: string;
  label: string;
  kind: "text" | "textarea" | "date" | "email" | "tel" | "select" | "yesno" | "check" | "multi";
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
];

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
  };
}

/** One section's answers as the API takes them: an empty answer is "not answered yet". */
function toBody(values: Record<string, Value>): Record<string, Value> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === "" ? null : v]));
}

/** The applicant's application wizard (TRD §10.2; spec stories 4–11, 13–16). */
export function ApplicationEditPage() {
  const mine = useQuery(mineQuery);
  if (mine.isPending) return <div className="h-48 animate-pulse rounded bg-slate-200" />;
  if (mine.isError)
    return <Alert tone="error">We couldn't load your application. Please try again.</Alert>;
  const current =
    mine.data.items.find((a) => a.status === "DRAFT") ?? mine.data.items[0] ?? undefined;
  if (current === undefined) return <StartApplication />;
  if (current.status !== "DRAFT")
    return (
      <Alert tone="success">
        Your application {current.referenceNo ?? ""} has been submitted. We'll email you about its
        progress.
      </Alert>
    );
  return <LoadApplication id={current.id} />;
}

function StartApplication() {
  const intake = useQuery(currentIntakeQuery);
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  if (intake.isPending) return <div className="h-48 animate-pulse rounded bg-slate-200" />;
  if (intake.isError || intake.data.intake?.status !== "OPEN")
    return (
      <Alert tone="error">
        Applications aren't open at the moment. The apply page shows when they open.
      </Alert>
    );
  const { intake: open, programmes } = intake.data;

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(async () => {
          await api<typeof applications.startApplication>("POST", "/applications", {
            body: { programmeId: form.get("programmeId"), studyMode: form.get("studyMode") },
          });
          await queryClient.invalidateQueries({ queryKey: ["applications"] });
          await queryClient.invalidateQueries({ queryKey: ["me"] });
        });
      }}
    >
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Start your application</h2>
        <p className="text-sm text-slate-600">
          For the {open.academicSessionName}. Applications close on{" "}
          <CalendarDate value={open.closesOn} />.
        </p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <fieldset className="space-y-2">
        <legend className="font-medium">Programme</legend>
        {programmes.map((p, index) => (
          <label key={p.id} className="flex items-center gap-2">
            <input
              type="radio"
              name="programmeId"
              value={p.id}
              required
              defaultChecked={index === 0}
            />
            {p.name}
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-medium">Study mode</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="studyMode" value="ON_CAMPUS" required />
          On campus
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="studyMode" value="ONLINE" required />
          Online
        </label>
      </fieldset>
      <SubmitButton busy={busy}>Start my application</SubmitButton>
    </form>
  );
}

function LoadApplication({ id }: { id: string }) {
  const application = useQuery({
    queryKey: ["applications", id],
    queryFn: ({ signal }) =>
      api<typeof applications.getApplication>("GET", "/applications/:id", {
        params: { id },
        signal,
      }),
    // The wizard owns the draft once loaded; refetching would fight the autosave.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (application.isPending) return <div className="h-48 animate-pulse rounded bg-slate-200" />;
  if (application.isError)
    return <Alert tone="error">We couldn't load your application. Please try again.</Alert>;
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
  const [step, setStep] = useState(() =>
    Math.max(
      0,
      SECTIONS.findIndex((s) => initial.missing[s.key].length > 0),
    ),
  );

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
  };

  const go = (to: number) => {
    void save();
    setStep(to);
    window.scrollTo({ top: 0 });
  };

  const section = SECTIONS[step] ?? SECTIONS[0];
  if (section === undefined) return null;
  const done = SECTIONS.filter((s) => application.missing[s.key].length === 0).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Your application</h2>
          <p className="text-sm text-slate-600">
            {application.programme.name} ·{" "}
            {application.studyMode === "ON_CAMPUS" ? "On campus" : "Online"} ·{" "}
            {application.intake.academicSessionName}
          </p>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-slate-600">
          {SAVE_LABEL[saveState]}
        </p>
      </div>
      {saveState === "conflict" ? (
        <Alert tone="error">
          Your application was changed in another window or tab.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </button>{" "}
          to carry on from the latest version.
        </Alert>
      ) : null}

      <nav aria-label="Sections">
        <p className="mb-2 text-sm text-slate-600">
          {done} of {SECTIONS.length} sections complete
        </p>
        <ol className="flex flex-wrap gap-2 text-sm">
          {SECTIONS.map((s, index) => {
            const complete = application.missing[s.key].length === 0;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => {
                    go(index);
                  }}
                  aria-current={index === step ? "step" : undefined}
                  className={`rounded border px-2 py-1 ${index === step ? "border-brand bg-brand text-white" : "border-slate-300 bg-white"}`}
                >
                  {index + 1}. {s.title}
                  {complete ? <span aria-label=" (complete)"> ✓</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section className="space-y-4 rounded border border-slate-200 bg-white p-4">
        <h3 className="text-lg font-semibold">
          {step + 1}. {section.title}
        </h3>
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
      </section>

      <div className="flex justify-between">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => {
            go(step - 1);
          }}
          className="rounded border border-slate-300 bg-white px-4 py-2 disabled:opacity-50"
        >
          Back
        </button>
        {step < SECTIONS.length - 1 ? (
          <button
            type="button"
            onClick={() => {
              go(step + 1);
            }}
            className="rounded bg-brand px-4 py-2 font-medium text-white"
          >
            Next
          </button>
        ) : null}
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
        <p className="text-sm text-slate-600">
          You must be at least {application.minimumAgeYears} on{" "}
          <CalendarDate value={application.intake.startsOn} />, when the session starts.
        </p>
      );
    case "spiritual":
      return (
        <p className="text-sm text-slate-600">
          Only the Admissions Officers and the System Admin see your answers in this section.
        </p>
      );
    case "declaration":
      return (
        <div className="space-y-2 text-sm">
          <p className="rounded bg-slate-50 p-3">{application.texts.declarationText}</p>
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
      return <p className="rounded bg-slate-50 p-3 text-sm">{application.texts.consentText}</p>;
    default:
      return null;
  }
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
  const described = error ? `${id}-error` : field.hint ? `${id}-hint` : undefined;
  const common = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": described,
    className:
      "block w-full rounded border border-slate-300 bg-white px-3 py-2 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30",
  } as const;
  const str = typeof value === "string" ? value : "";

  let control: ReactNode;
  switch (field.kind) {
    case "textarea":
      control = (
        <textarea
          {...common}
          rows={3}
          value={str}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );
      break;
    case "select":
      control = (
        <select
          {...common}
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
        </select>
      );
      break;
    case "yesno":
      return (
        <fieldset className="space-y-1" aria-describedby={described}>
          <legend className="text-sm font-medium text-slate-700">{field.label}</legend>
          <div className="flex gap-4">
            {([true, false] as const).map((answer) => (
              <label key={String(answer)} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={id}
                  checked={value === answer}
                  onChange={() => {
                    onChange(answer);
                  }}
                />
                {answer ? "Yes" : "No"}
              </label>
            ))}
          </div>
        </fieldset>
      );
    case "check":
      return (
        <label className="flex items-start gap-2">
          <input
            id={id}
            type="checkbox"
            className="mt-1"
            checked={value === true}
            onChange={(e) => {
              onChange(e.target.checked);
            }}
          />
          <span>{field.label}</span>
        </label>
      );
    case "multi": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-slate-700">{field.label}</legend>
          <div className="grid grid-cols-2 gap-1">
            {field.options?.map(([v, label]) => (
              <label key={v} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={chosen.includes(v)}
                  onChange={(e) => {
                    onChange(e.target.checked ? [...chosen, v] : chosen.filter((c) => c !== v));
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    default:
      control = (
        <input
          {...common}
          type={field.kind}
          autoComplete={field.kind === "email" ? "email" : field.kind === "tel" ? "tel" : "off"}
          value={str}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      );
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {field.label}
      </label>
      {control}
      {field.hint && !error ? (
        <p id={`${id}-hint`} className="text-sm text-slate-500">
          {field.hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
