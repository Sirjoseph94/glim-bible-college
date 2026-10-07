import type { admissions, calendar, Intake } from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Alert, Field, formText, SubmitButton } from "../components/form";
import { CalendarDate } from "../components/time";
import { useSubmit } from "../components/use-submit";

const intakesQuery = queryOptions({
  queryKey: ["intakes"],
  queryFn: ({ signal }) => api<typeof admissions.listIntakes>("GET", "/intakes", { signal }),
});
const sessionsQuery = queryOptions({
  queryKey: ["academic-sessions"],
  queryFn: ({ signal }) =>
    api<typeof calendar.listAcademicSessions>("GET", "/academic-sessions", { signal }),
});

type Transition = typeof admissions.openIntake;
const PATHS = { open: "/intakes/:id/open", close: "/intakes/:id/close" } as const satisfies Record<
  string,
  Transition["path"]
>;

/** The yearly intake for the Admissions Officer (TRD §10.1). */
export function AdmissionsIntakesPage() {
  const intakes = useQuery(intakesQuery);
  const sessions = useQuery(sessionsQuery);
  const queryClient = useQueryClient();
  const { busy, error, fieldErrors, run } = useSubmit();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["intakes"] });
  const act = (intake: Intake, action: keyof typeof PATHS) => {
    void run(async () => {
      await api<Transition>("POST", PATHS[action], { params: { id: intake.id } });
      await refresh();
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Intakes</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="space-y-2">
        {intakes.data?.items.map((i) => (
          <li key={i.id} className="space-y-1 rounded border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">
                Intake {i.code} · {i.academicSessionName}
              </span>
              <span className="text-sm text-slate-600">{i.status.toLowerCase()}</span>
            </div>
            <div className="text-sm text-slate-600">
              Applications <CalendarDate value={i.opensOn} /> – <CalendarDate value={i.closesOn} />{" "}
              · offers must be accepted within {i.offerAcceptanceDays} days
            </div>
            <div className="flex gap-3 text-sm">
              {i.status === "PLANNED" ? (
                <button
                  type="button"
                  className="underline"
                  disabled={busy}
                  onClick={() => {
                    act(i, "open");
                  }}
                >
                  Open now
                </button>
              ) : null}
              {i.status !== "CLOSED" ? (
                <button
                  type="button"
                  className="underline"
                  disabled={busy}
                  onClick={() => {
                    act(i, "close");
                  }}
                >
                  Close now
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const d = new FormData(form);
          void run(async () => {
            await api<typeof admissions.createIntake>("POST", "/intakes", {
              body: {
                code: formText(d, "code"),
                academicSessionId: formText(d, "academicSessionId"),
                opensOn: formText(d, "opensOn"),
                closesOn: formText(d, "closesOn"),
              },
            });
            form.reset();
            await refresh();
          });
        }}
      >
        <h3 className="font-semibold sm:col-span-2">Plan an intake</h3>
        <Field
          id="i-code"
          name="code"
          label="Intake (year students start, e.g. 2027)"
          required
          error={fieldErrors.code}
        />
        <label className="text-sm">
          <span className="block font-medium text-slate-700">
            Academic Session students start in
          </span>
          <select
            name="academicSessionId"
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-2"
            required
          >
            {sessions.data?.items
              .filter((s) => s.status === "PLANNED")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        <Field
          id="i-opens"
          name="opensOn"
          type="date"
          label="Applications open (November)"
          required
        />
        <Field
          id="i-closes"
          name="closesOn"
          type="date"
          label="Applications close (June)"
          required
        />
        <SubmitButton busy={busy}>Plan intake</SubmitButton>
      </form>
    </div>
  );
}
