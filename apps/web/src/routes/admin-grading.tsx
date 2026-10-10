import type { academic, GradingScheme, Programme, results } from "@glim/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { LoadFailed } from "../components/app/page-states";
import { formText } from "../components/form";
import { Time } from "../components/time";
import { useSubmit } from "../components/use-submit";
import { Badge } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/choice";
import { bodyCell, DataTable, headCell, numericCell } from "../components/ui/data-table";
import { Sheet } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Select, TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { cn } from "../design/cn";

const schemesKey = ["grading-schemes"];

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
 * saves a new version that its programmes move to. Editing happens in a Sheet.
 */
export function AdminGradingPage() {
  const schemes = useQuery({
    queryKey: schemesKey,
    queryFn: ({ signal }) =>
      api<typeof results.listGradingSchemes>("GET", "/grading-schemes", { signal }),
  });
  const [editing, setEditing] = useState<{ scheme: GradingScheme; asNew: boolean } | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader
        overline="Registrar"
        title="Grading schemes"
        meta="Results are graded with their programme's scheme when a Lecturer finalizes them. Once a scheme has been used it can't change; save a new version instead."
      />
      {schemes.isPending ? (
        <SkeletonGroup label="Loading the grading schemes">
          <Skeleton className="h-60" />
          <Skeleton className="h-40" />
        </SkeletonGroup>
      ) : schemes.isError ? (
        <LoadFailed what="the grading schemes" onRetry={() => void schemes.refetch()} />
      ) : (
        <>
          {schemes.data.items.length === 0 ? (
            <Card>
              <EmptyState icon="settings" title="No grading schemes yet">
                Grading schemes are set up with the system. Ask the system administrator.
              </EmptyState>
            </Card>
          ) : (
            <Card list role="list">
              {schemes.data.items.map((s) => (
                <SchemeRow
                  key={s.id}
                  scheme={s}
                  all={schemes.data.items}
                  onEdit={(asNew) => {
                    setEditing({ scheme: s, asNew });
                  }}
                />
              ))}
            </Card>
          )}
          {editing !== null ? (
            <SchemeSheet
              key={`${editing.scheme.id}:${String(editing.asNew)}`}
              scheme={editing.scheme}
              asNew={editing.asNew}
              onDone={() => {
                setEditing(null);
              }}
            />
          ) : null}
          <ProgrammeSchemes schemes={schemes.data.items} />
        </>
      )}
    </div>
  );
}

function SchemeRow({
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
    <div role="listitem" aria-label={s.name} className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-heading">{s.name}</h2>
        {s.lockedAt === null ? (
          <Badge tone="neutral">Not used yet</Badge>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
            <Badge tone="success">In use</Badge>
            <span>
              since <Time value={s.lockedAt} />
            </span>
          </span>
        )}
      </div>
      <div className="space-y-1 text-body-sm">
        {replaces !== undefined ? (
          <p className="text-ink-muted">A new version of {replaces.name}.</p>
        ) : null}
        <p>
          Programmes:{" "}
          {s.programmes.length === 0 ? "none" : s.programmes.map((x) => x.code).join(", ")}
        </p>
      </div>
      <DataTable caption={`${s.name} grade bands`} minWidth="min-w-80">
        <thead>
          <tr>
            <th scope="col" className={headCell}>
              Letter
            </th>
            <th scope="col" className={headCell}>
              Percent
            </th>
            <th scope="col" className={`${headCell} ${numericCell}`}>
              Points
            </th>
            <th scope="col" className={headCell}>
              Pass
            </th>
          </tr>
        </thead>
        <tbody>
          {s.bands.map((b) => (
            <tr key={b.letter}>
              <th scope="row" className={cn(bodyCell, "text-left font-semibold")}>
                {b.letter}
              </th>
              <td className={`${bodyCell} tabular-nums`}>
                {fromX100(b.minX100)}–{fromX100(b.maxX100)}
              </td>
              <td className={`${bodyCell} ${numericCell}`}>{fromX100(b.pointsX100)}</td>
              <td className={bodyCell}>{b.pass ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <div className="space-y-1 text-body-sm">
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
      </div>
      <div className="flex flex-wrap gap-2">
        {s.lockedAt === null ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onEdit(false);
            }}
          >
            Edit
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            onEdit(true);
          }}
        >
          {s.lockedAt === null ? "Copy as a new scheme" : "Change (saves a new version)"}
        </Button>
      </div>
    </div>
  );
}

const REPEAT_LABELS: Record<GradingScheme["repeatPolicy"], string> = {
  BEST: "the best attempt counts",
  REPLACE_LATEST: "the latest attempt counts",
  KEEP_ALL: "every attempt counts",
};

/** Edits a scheme in place, copies it, or saves a new version of a locked one. */
function SchemeSheet({
  scheme,
  asNew,
  onDone,
}: {
  scheme: GradingScheme;
  asNew: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const { busy, problem, run } = useSubmit();
  const [bands, setBands] = useState<Band[]>(scheme.bands);
  const [classes, setClasses] = useState<ClassBand[]>(scheme.classBands);
  const [invalid, setInvalid] = useState<string | null>(null);
  const version = asNew && scheme.lockedAt !== null;
  const title = asNew
    ? version
      ? `New version of ${scheme.name}`
      : "New scheme"
    : `Edit ${scheme.name}`;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      title={title}
      description={
        version
          ? `${
              scheme.programmes.length === 0
                ? "No programme uses it now."
                : `${scheme.programmes.map((x) => x.code).join(", ")} will use the new version.`
            } Results already finalized keep the old one.`
          : undefined
      }
      footer={
        <>
          <Button type="submit" form={formId} block loading={busy}>
            {asNew ? (version ? "Save new version" : "Create scheme") : "Save scheme"}
          </Button>
          <Button variant="quiet" block onClick={onDone}>
            Cancel
          </Button>
        </>
      }
    >
      <form
        id={formId}
        aria-label="Grading scheme"
        className="space-y-5"
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
            setInvalid("Use numbers with at most two decimal places.");
            return;
          }
          setInvalid(null);
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
        {/* One message at a time: our own check first, then the server's answer. */}
        {invalid !== null ? (
          <Banner tone="danger" title={invalid} />
        ) : problem !== null ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        <TextField
          label="Name"
          name="name"
          required
          maxLength={100}
          defaultValue={asNew ? `${scheme.name} (new)` : scheme.name}
        />
        <input type="hidden" name="kind" value={scheme.kind} />
        <fieldset className="space-y-3">
          <legend className="mb-2 text-subhead">Letter bands (percent)</legend>
          {bands.map((b, i) => (
            <div
              key={i}
              role="group"
              aria-label={`Band ${b.letter}`}
              className="space-y-1 rounded-md bg-surface-sunken p-3"
            >
              <div className="grid grid-cols-4 gap-2">
                <TextField
                  label="Letter"
                  value={b.letter}
                  maxLength={4}
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
              </div>
              <Checkbox
                label="Pass"
                checked={b.pass}
                onChange={(e) => {
                  setBands(bands.map((x, j) => (j === i ? { ...x, pass: e.target.checked } : x)));
                }}
              />
            </div>
          ))}
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="mb-2 text-subhead">Award classes (final CGPA)</legend>
          {classes.map((c, i) => (
            <div
              key={i}
              role="group"
              aria-label={`Class ${c.label}`}
              className="grid grid-cols-4 gap-2 rounded-md bg-surface-sunken p-3"
            >
              <div className="col-span-2">
                <TextField
                  label="Class"
                  value={c.label}
                  maxLength={60}
                  onChange={(e) => {
                    setClasses(
                      classes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    );
                  }}
                />
              </div>
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
        <div className="grid gap-4 md:grid-cols-2">
          <Decimal label="Pass mark (%)" name="passMark" value={scheme.passMarkX100} />
          <Decimal label="Maximum points" name="maxPoints" value={scheme.maxPointsX100} />
          <Decimal label="No award below CGPA" name="minAward" value={scheme.minAwardCgpaX100} />
          <Decimal
            label="Good standing from CGPA"
            name="goodStanding"
            value={scheme.goodStandingCgpaX100}
          />
          <TextField
            label="Probation from CGPA"
            optional
            name="probation"
            inputMode="decimal"
            defaultValue={
              scheme.probationCgpaX100 === null ? "" : fromX100(scheme.probationCgpaX100)
            }
          />
          <Select label="Repeated courses" name="repeatPolicy" defaultValue={scheme.repeatPolicy}>
            <option value="BEST">The best attempt counts</option>
            <option value="REPLACE_LATEST">The latest attempt counts</option>
            <option value="KEEP_ALL">Every attempt counts</option>
          </Select>
        </div>
      </form>
    </Sheet>
  );
}

/** A hundredths value typed as a decimal; marked invalid until it parses, and kept until then. */
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
    <TextField
      label={label}
      value={text}
      inputMode="decimal"
      aria-invalid={parsed === null ? true : undefined}
      onChange={(e) => {
        setText(e.target.value);
        const v = toX100(e.target.value);
        if (v !== null) onChange(v);
      }}
    />
  );
}

function Decimal({ label, name, value }: { label: string; name: string; value: number }) {
  return (
    <TextField
      label={label}
      name={name}
      required
      inputMode="decimal"
      defaultValue={fromX100(value)}
    />
  );
}

/** Which scheme each programme grades with; each programme saves on its own. */
function ProgrammeSchemes({ schemes }: { schemes: GradingScheme[] }) {
  const programmes = useQuery({
    queryKey: ["programmes"],
    queryFn: ({ signal }) => api<typeof academic.listProgrammes>("GET", "/programmes", { signal }),
  });
  return (
    <section aria-labelledby="programme-schemes" className="space-y-3">
      <h2 id="programme-schemes" className="text-heading">
        Programmes
      </h2>
      {programmes.isPending ? (
        <SkeletonGroup label="Loading the programmes">
          <Skeleton className="h-32" />
        </SkeletonGroup>
      ) : programmes.isError ? (
        <LoadFailed what="the programmes" onRetry={() => void programmes.refetch()} />
      ) : programmes.data.items.length === 0 ? (
        <Card>
          <EmptyState icon="book" title="No programmes yet" headingLevel={3}>
            Programmes are added in academic setup.
          </EmptyState>
        </Card>
      ) : (
        <Card list role="list">
          {programmes.data.items.map((p) => (
            <ProgrammeRow key={p.id} programme={p} schemes={schemes} />
          ))}
        </Card>
      )}
    </section>
  );
}

function ProgrammeRow({
  programme: p,
  schemes,
}: {
  programme: Programme;
  schemes: GradingScheme[];
}) {
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  return (
    <div role="listitem" aria-label={`${p.code} ${p.name}`} className="space-y-3 px-4 py-3">
      {problem !== null ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}
      <form
        className="flex flex-col gap-2 md:flex-row md:items-end"
        aria-label={`Scheme for ${p.code}`}
        onSubmit={(e) => {
          e.preventDefault();
          const gradingSchemeId = formText(new FormData(e.currentTarget), "scheme");
          void run(async () => {
            await api<typeof results.setProgrammeScheme>("PUT", "/programmes/:id/grading-scheme", {
              params: { id: p.id },
              body: { gradingSchemeId },
            });
            await queryClient.invalidateQueries({ queryKey: schemesKey });
            await queryClient.invalidateQueries({ queryKey: ["programmes"] });
          });
        }}
      >
        <div className="min-w-0 flex-1">
          <Select
            label={`${p.code} ${p.name}`}
            name="scheme"
            defaultValue={p.gradingSchemeId ?? ""}
          >
            {p.gradingSchemeId === null ? <option value="">No scheme yet</option> : null}
            {schemes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary" loading={busy}>
          Save
        </Button>
      </form>
    </div>
  );
}
