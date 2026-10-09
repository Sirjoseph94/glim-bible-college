import type { academic, GradingScheme, Programme, results } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { Alert, formText } from "../components/form";
import { Time } from "../components/time";
import { useSubmit } from "../components/use-submit";

const schemesKey = ["grading-schemes"];
const input = "rounded border border-slate-300 px-2 py-1";

type Band = GradingScheme["bands"][number];
type ClassBand = GradingScheme["classBands"][number];
type SchemeBody = Omit<
  GradingScheme,
  "id" | "supersedesId" | "lockedAt" | "programmes" | "version"
>;

/** 7000 → "70", 6999 → "69.99": hundredths shown as a decimal, with no float arithmetic. */
function fromX100(v: number): string {
  const whole = Math.trunc(v / 100);
  const part = v % 100;
  return part === 0 ? String(whole) : `${String(whole)}.${String(part).padStart(2, "0")}`;
}

/** "69.99" → 6999; null if it isn't a number with at most two decimal places. */
function toX100(text: string): number | null {
  const m = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (m === null) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/**
 * Grading schemes (TRD §14.4): the Registrar's letter bands, repeat policy, standing and award
 * classes, and which programme uses which. A scheme results have used is locked; changing it
 * saves a new version that its programmes move to.
 */
export function AdminGradingPage() {
  const schemes = useQuery({
    queryKey: schemesKey,
    queryFn: ({ signal }) =>
      api<typeof results.listGradingSchemes>("GET", "/grading-schemes", { signal }),
  });
  const [editing, setEditing] = useState<{ scheme: GradingScheme; asNew: boolean } | null>(null);
  if (schemes.isPending) return <div className="h-40 animate-pulse rounded bg-slate-200" />;
  if (schemes.isError) return <Alert tone="error">We couldn't load the grading schemes.</Alert>;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Grading schemes</h2>
      <p className="text-sm text-slate-600">
        Results are graded with their programme's scheme when a Lecturer finalizes them. Once a
        scheme has been used it can't change; save a new version instead.
      </p>
      {editing !== null ? (
        <SchemeForm
          key={`${editing.scheme.id}:${String(editing.asNew)}`}
          scheme={editing.scheme}
          asNew={editing.asNew}
          onDone={() => {
            setEditing(null);
          }}
        />
      ) : null}
      <ul className="space-y-3">
        {schemes.data.items.map((s) => (
          <SchemeCard
            key={s.id}
            scheme={s}
            all={schemes.data.items}
            onEdit={(asNew) => {
              setEditing({ scheme: s, asNew });
              window.scrollTo({ top: 0 });
            }}
          />
        ))}
      </ul>
      <ProgrammeSchemes schemes={schemes.data.items} />
    </div>
  );
}

function SchemeCard({
  scheme: s,
  all,
  onEdit,
}: {
  scheme: GradingScheme;
  all: GradingScheme[];
  onEdit: (asNew: boolean) => void;
}) {
  const replaces = all.find((x) => x.id === s.supersedesId);
  return (
    <li
      className="space-y-2 rounded border border-slate-200 bg-white p-3 text-sm"
      aria-label={s.name}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{s.name}</h3>
        <span className="text-slate-600">
          {s.lockedAt === null ? (
            "Not used yet"
          ) : (
            <>
              In use since <Time value={s.lockedAt} />
            </>
          )}
        </span>
      </div>
      {replaces !== undefined ? (
        <p className="text-slate-600">A new version of {replaces.name}.</p>
      ) : null}
      <p>
        Programmes:{" "}
        {s.programmes.length === 0 ? "none" : s.programmes.map((x) => x.code).join(", ")}
      </p>
      <div className="overflow-x-auto">
        <table className="text-left">
          <thead>
            <tr className="text-slate-600">
              <th className="pr-3 font-normal">Letter</th>
              <th className="pr-3 font-normal">Percent</th>
              <th className="pr-3 font-normal">Points</th>
              <th className="font-normal">Pass</th>
            </tr>
          </thead>
          <tbody>
            {s.bands.map((b) => (
              <tr key={b.letter}>
                <td className="pr-3 font-medium">{b.letter}</td>
                <td className="pr-3">
                  {fromX100(b.minX100)}–{fromX100(b.maxX100)}
                </td>
                <td className="pr-3">{fromX100(b.pointsX100)}</td>
                <td>{b.pass ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Award classes:{" "}
        {s.classBands
          .map((c) => `${c.label} ${fromX100(c.minCgpaX100)}–${fromX100(c.maxCgpaX100)}`)
          .join(" · ")}
        ; no award below {fromX100(s.minAwardCgpaX100)}.
      </p>
      <p>
        Repeats: {REPEAT_LABELS[s.repeatPolicy]}. Good standing from CGPA{" "}
        {fromX100(s.goodStandingCgpaX100)}
        {s.probationCgpaX100 === null ? "" : `; probation from ${fromX100(s.probationCgpaX100)}`}.
      </p>
      <div className="flex flex-wrap gap-3">
        {s.lockedAt === null ? (
          <button
            type="button"
            className="text-brand underline"
            onClick={() => {
              onEdit(false);
            }}
          >
            Edit
          </button>
        ) : null}
        <button
          type="button"
          className="text-brand underline"
          onClick={() => {
            onEdit(true);
          }}
        >
          {s.lockedAt === null ? "Copy as a new scheme" : "Change (saves a new version)"}
        </button>
      </div>
    </li>
  );
}

const REPEAT_LABELS: Record<GradingScheme["repeatPolicy"], string> = {
  BEST: "the best attempt counts",
  REPLACE_LATEST: "the latest attempt counts",
  KEEP_ALL: "every attempt counts",
};

function SchemeForm({
  scheme,
  asNew,
  onDone,
}: {
  scheme: GradingScheme;
  asNew: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const [bands, setBands] = useState<Band[]>(scheme.bands);
  const [classes, setClasses] = useState<ClassBand[]>(scheme.classBands);
  const [problem, setProblem] = useState<string | null>(null);
  const version = asNew && scheme.lockedAt !== null;
  return (
    <form
      aria-label="Grading scheme"
      className="space-y-3 rounded border border-slate-200 bg-white p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const read = (name: string) => toX100(formText(data, name));
        const probation = formText(data, "probation").trim();
        const fields = {
          passMarkX100: read("passMark"),
          maxPointsX100: read("maxPoints"),
          minAwardCgpaX100: read("minAward"),
          goodStandingCgpaX100: read("goodStanding"),
          probationCgpaX100: probation === "" ? null : toX100(probation),
        };
        const required = [
          fields.passMarkX100,
          fields.maxPointsX100,
          fields.minAwardCgpaX100,
          fields.goodStandingCgpaX100,
        ];
        if (required.includes(null) || (probation !== "" && fields.probationCgpaX100 === null)) {
          setProblem("Use numbers with at most two decimal places.");
          return;
        }
        setProblem(null);
        const body: SchemeBody = {
          name: formText(data, "name").trim(),
          kind: formText(data, "kind") as GradingScheme["kind"],
          bands,
          classBands: classes,
          repeatPolicy: formText(data, "repeatPolicy") as GradingScheme["repeatPolicy"],
          passMarkX100: fields.passMarkX100 ?? 0,
          maxPointsX100: fields.maxPointsX100 ?? 0,
          minAwardCgpaX100: fields.minAwardCgpaX100 ?? 0,
          goodStandingCgpaX100: fields.goodStandingCgpaX100 ?? 0,
          probationCgpaX100: fields.probationCgpaX100,
        };
        void run(async () => {
          if (asNew)
            await api<typeof results.createGradingScheme>("POST", "/grading-schemes", {
              body: { ...body, ...(version ? { supersedesId: scheme.id } : {}) },
              headers: { "idempotency-key": crypto.randomUUID() },
            });
          else
            await api<typeof results.updateGradingScheme>("PATCH", "/grading-schemes/:id", {
              params: { id: scheme.id },
              body,
              headers: { "if-match": `"${String(scheme.version)}"` },
            });
          await queryClient.invalidateQueries({ queryKey: schemesKey });
          onDone();
        });
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">
          {asNew
            ? version
              ? `New version of ${scheme.name}`
              : "New scheme"
            : `Edit ${scheme.name}`}
        </h3>
        <button type="button" className="text-brand underline" onClick={onDone}>
          Cancel
        </button>
      </div>
      {version ? (
        <p className="text-slate-600">
          {scheme.programmes.length === 0
            ? "No programme uses it now."
            : `${scheme.programmes.map((x) => x.code).join(", ")} will use the new version.`}{" "}
          Results already finalized keep the old one.
        </p>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {problem ? <Alert tone="error">{problem}</Alert> : null}
      <label className="block">
        <span className="block text-slate-700">Name</span>
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={asNew ? `${scheme.name} (new)` : scheme.name}
          className={`block w-full ${input}`}
        />
      </label>
      <input type="hidden" name="kind" value={scheme.kind} />
      <fieldset className="space-y-1">
        <legend className="font-medium text-slate-700">Letter bands (percent)</legend>
        {bands.map((b, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={`Band ${b.letter}`}
          >
            <input
              aria-label="Letter"
              value={b.letter}
              maxLength={4}
              className={`w-14 ${input}`}
              onChange={(e) => {
                setBands(bands.map((x, j) => (j === i ? { ...x, letter: e.target.value } : x)));
              }}
            />
            <NumberCell
              label="From"
              value={b.minX100}
              onChange={(v) => {
                setBands(bands.map((x, j) => (j === i ? { ...x, minX100: v } : x)));
              }}
            />
            <NumberCell
              label="To"
              value={b.maxX100}
              onChange={(v) => {
                setBands(bands.map((x, j) => (j === i ? { ...x, maxX100: v } : x)));
              }}
            />
            <NumberCell
              label="Points"
              value={b.pointsX100}
              onChange={(v) => {
                setBands(bands.map((x, j) => (j === i ? { ...x, pointsX100: v } : x)));
              }}
            />
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={b.pass}
                onChange={(e) => {
                  setBands(bands.map((x, j) => (j === i ? { ...x, pass: e.target.checked } : x)));
                }}
              />
              Pass
            </label>
          </div>
        ))}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="font-medium text-slate-700">Award classes (final CGPA)</legend>
        {classes.map((c, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={`Class ${c.label}`}
          >
            <input
              aria-label="Class"
              value={c.label}
              maxLength={60}
              className={`w-32 ${input}`}
              onChange={(e) => {
                setClasses(classes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)));
              }}
            />
            <NumberCell
              label="From"
              value={c.minCgpaX100}
              onChange={(v) => {
                setClasses(classes.map((x, j) => (j === i ? { ...x, minCgpaX100: v } : x)));
              }}
            />
            <NumberCell
              label="To"
              value={c.maxCgpaX100}
              onChange={(v) => {
                setClasses(classes.map((x, j) => (j === i ? { ...x, maxCgpaX100: v } : x)));
              }}
            />
          </div>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <Labelled label="Pass mark (%)" name="passMark" value={scheme.passMarkX100} />
        <Labelled label="Maximum points" name="maxPoints" value={scheme.maxPointsX100} />
        <Labelled label="No award below CGPA" name="minAward" value={scheme.minAwardCgpaX100} />
        <Labelled
          label="Good standing from CGPA"
          name="goodStanding"
          value={scheme.goodStandingCgpaX100}
        />
        <label className="block">
          <span className="block text-slate-700">Probation from CGPA (optional)</span>
          <input
            name="probation"
            inputMode="decimal"
            defaultValue={
              scheme.probationCgpaX100 === null ? "" : fromX100(scheme.probationCgpaX100)
            }
            className={`w-24 ${input}`}
          />
        </label>
        <label className="block">
          <span className="block text-slate-700">Repeated courses</span>
          <select
            name="repeatPolicy"
            defaultValue={scheme.repeatPolicy}
            className={`block w-full ${input}`}
          >
            <option value="BEST">The best attempt counts</option>
            <option value="REPLACE_LATEST">The latest attempt counts</option>
            <option value="KEEP_ALL">Every attempt counts</option>
          </select>
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-brand px-3 py-2 text-white disabled:opacity-60"
      >
        {asNew ? (version ? "Save new version" : "Create scheme") : "Save scheme"}
      </button>
    </form>
  );
}

function NumberCell({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(fromX100(value));
  const parsed = toX100(text);
  return (
    <label className="flex items-center gap-1">
      <span className="text-slate-600">{label}</span>
      <input
        aria-label={label}
        value={text}
        inputMode="decimal"
        aria-invalid={parsed === null ? true : undefined}
        className={`w-20 ${input}`}
        onChange={(e) => {
          setText(e.target.value);
          const v = toX100(e.target.value);
          if (v !== null) onChange(v);
        }}
      />
    </label>
  );
}

function Labelled({ label, name, value }: { label: string; name: string; value: number }) {
  return (
    <label className="block">
      <span className="block text-slate-700">{label}</span>
      <input
        name={name}
        required
        inputMode="decimal"
        defaultValue={fromX100(value)}
        className={`w-24 ${input}`}
      />
    </label>
  );
}

function ProgrammeSchemes({ schemes }: { schemes: GradingScheme[] }) {
  const queryClient = useQueryClient();
  const { busy, error, run } = useSubmit();
  const programmes = useQuery({
    queryKey: ["programmes"],
    queryFn: ({ signal }) => api<typeof academic.listProgrammes>("GET", "/programmes", { signal }),
  });
  const items: Programme[] = programmes.data?.items ?? [];
  return (
    <section className="space-y-2 rounded border border-slate-200 bg-white p-3 text-sm">
      <h3 className="font-medium">Programmes</h3>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="space-y-2">
        {items.map((p) => (
          <li key={p.id}>
            <form
              className="flex flex-wrap items-end gap-2"
              aria-label={`Scheme for ${p.code}`}
              onSubmit={(e) => {
                e.preventDefault();
                const gradingSchemeId = formText(new FormData(e.currentTarget), "scheme");
                void run(async () => {
                  await api<typeof results.setProgrammeScheme>(
                    "PUT",
                    "/programmes/:id/grading-scheme",
                    { params: { id: p.id }, body: { gradingSchemeId } },
                  );
                  await queryClient.invalidateQueries({ queryKey: schemesKey });
                  await queryClient.invalidateQueries({ queryKey: ["programmes"] });
                });
              }}
            >
              <label className="block">
                <span className="block text-slate-700">
                  {p.code} {p.name}
                </span>
                <select
                  name="scheme"
                  defaultValue={p.gradingSchemeId ?? ""}
                  className={`block ${input}`}
                >
                  {p.gradingSchemeId === null ? <option value="">No scheme yet</option> : null}
                  {schemes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded border border-slate-300 px-3 py-1"
              >
                Save
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
