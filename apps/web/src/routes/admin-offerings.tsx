import type {
  academic,
  calendar,
  enrollment,
  Offering,
  offerings,
  RosterItem,
} from "@glim/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useId, useState } from "react";
import { api } from "../api/client";
import { PageHeader } from "../components/app/page-header";
import { isNotAvailable, LoadFailed, NotAvailable } from "../components/app/page-states";
import { useDetailBar } from "../components/app/shell-parts";
import { formText } from "../components/form";
import { OfferingStatusBadge } from "../components/app/offering-status";
import { Badge, type Tone } from "../components/ui/badge";
import { Banner } from "../components/ui/banner";
import { Button } from "../components/ui/button";
import { Card, cardClass } from "../components/ui/card";
import { DataTable, bodyCell, headCell, stickyCell } from "../components/ui/data-table";
import { ConfirmDialog, Sheet } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { Select, TextField } from "../components/ui/field";
import { Skeleton, SkeletonGroup } from "../components/ui/skeleton";
import { useSubmit } from "../components/use-submit";

type Role = Offering["lecturers"][number]["role"];
type RosterEntry = RosterItem;

const ROLE_LABELS: Record<Role, string> = {
  PRIMARY: "Primary",
  CO_LECTURER: "Co-lecturer",
  ASSISTANT: "Assistant",
  GUEST_LECTURER: "Guest lecturer",
};

const ENROLLMENT_STATUS: Record<RosterEntry["status"], { tone: Tone; word: string }> = {
  ENROLLED: { tone: "success", word: "Enrolled" },
  DROPPED: { tone: "neutral", word: "Dropped" },
  WITHDRAWN: { tone: "warning", word: "Withdrawn" },
  COMPLETED: { tone: "neutral", word: "Completed" },
};

const SELECTION_LABELS: Record<RosterEntry["selection"], string> = {
  COMPULSORY: "Compulsory",
  ELECTIVE: "Elective",
  MANUAL: "Registered by the office",
};

const semestersQuery = queryOptions({
  queryKey: ["semesters"],
  queryFn: ({ signal }) => api<typeof calendar.listSemesters>("GET", "/semesters", { signal }),
});
const lecturersQuery = queryOptions({
  queryKey: ["lecturers"],
  queryFn: ({ signal }) => api<typeof offerings.listLecturers>("GET", "/lecturers", { signal }),
});
const offeringsQuery = (semesterId: string) =>
  queryOptions({
    queryKey: ["offerings", semesterId],
    queryFn: ({ signal }) =>
      api<typeof offerings.listOfferings>("GET", "/course-offerings", {
        signal,
        query: { semesterId },
      }),
    enabled: semesterId !== "",
  });
const offeringQuery = (id: string) =>
  queryOptions({
    queryKey: ["offering", id],
    queryFn: ({ signal }) =>
      api<typeof offerings.getOffering>("GET", "/course-offerings/:id", { signal, params: { id } }),
  });
const coursesQuery = queryOptions({
  queryKey: ["courses", "active"],
  queryFn: ({ signal }) =>
    api<typeof academic.listCourses>("GET", "/courses", {
      signal,
      query: { status: "ACTIVE", limit: 100 },
    }),
});

function OfferingBadge({ status }: { status: Offering["status"] }) {
  return <OfferingStatusBadge status={status} />;
}

/** Course Offerings per semester (TRD §9.2). */
export function AdminOfferingsPage() {
  const semesters = useQuery(semestersQuery);
  const [semesterId, setSemesterId] = useState("");
  const [offering, setOffering] = useState(false);
  const chosen = semesterId || (semesters.data?.items.find((s) => s.status !== "CLOSED")?.id ?? "");
  const list = useQuery(offeringsQuery(chosen));
  const semester = semesters.data?.items.find((s) => s.id === chosen);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Course Offerings"
        meta="The courses taught each semester, and who teaches them."
        actions={
          chosen === "" ? null : (
            <Button
              variant="primary"
              icon="book"
              onClick={() => {
                setOffering(true);
              }}
            >
              Offer a course this semester
            </Button>
          )
        }
      />
      {semesters.isPending ? (
        <SkeletonGroup label="Loading semesters">
          <Skeleton className="h-control" />
          <Skeleton className="h-40" />
        </SkeletonGroup>
      ) : semesters.isError ? (
        <LoadFailed what="the semesters" onRetry={() => void semesters.refetch()} />
      ) : semesters.data.items.length === 0 ? (
        <EmptyState icon="calendar" title="No semesters yet">
          Add a semester to an Academic Session on the Calendar page first.
        </EmptyState>
      ) : (
        <>
          <Select
            label="Semester"
            value={chosen}
            onChange={(e) => {
              setSemesterId(e.target.value);
            }}
          >
            {semesters.data.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code}) · {s.status.toLowerCase()}
              </option>
            ))}
          </Select>
          {list.isPending ? (
            <SkeletonGroup label="Loading Course Offerings">
              <Skeleton className="h-40" />
            </SkeletonGroup>
          ) : list.isError ? (
            <LoadFailed what="the Course Offerings" onRetry={() => void list.refetch()} />
          ) : list.data.items.length === 0 ? (
            <EmptyState icon="book" title="No offerings in this semester yet">
              Offer a course to put it on this semester's timetable.
            </EmptyState>
          ) : (
            <DataTable caption="Course Offerings" minWidth="min-w-160">
              <thead>
                <tr>
                  <th scope="col" className={`${headCell} ${stickyCell}`}>
                    Course
                  </th>
                  <th scope="col" className={headCell}>
                    Section
                  </th>
                  <th scope="col" className={headCell}>
                    Primary Lecturer
                  </th>
                  <th scope="col" className={headCell}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((o) => (
                  <tr key={o.id}>
                    <td className={`${bodyCell} ${stickyCell}`}>
                      <Link
                        to="/admin/offerings/$offeringId"
                        params={{ offeringId: o.id }}
                        className="inline-flex min-h-tap items-center text-brand underline"
                      >
                        {o.courseCode} {o.title}
                      </Link>
                    </td>
                    <td className={bodyCell}>{o.sectionCode}</td>
                    <td className={bodyCell}>
                      {o.lecturers.find((l) => l.role === "PRIMARY")?.lecturerName ?? (
                        <span className="text-ink-muted">No Primary yet</span>
                      )}
                    </td>
                    <td className={bodyCell}>
                      <OfferingBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </>
      )}
      {chosen !== "" ? (
        <NewOffering
          open={offering}
          onOpenChange={setOffering}
          semesterId={chosen}
          semesterName={semester ? `${semester.name} (${semester.code})` : undefined}
        />
      ) : null}
    </div>
  );
}

function NewOffering({
  open,
  onOpenChange,
  semesterId,
  semesterName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  semesterId: string;
  semesterName: string | undefined;
}) {
  const courses = useQuery({ ...coursesQuery, enabled: open });
  const lecturers = useQuery({ ...lecturersQuery, enabled: open });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const formId = useId();
  const { busy, problem, fieldErrors, run } = useSubmit();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Offer a course this semester"
      description={semesterName}
      footer={
        <Button type="submit" form={formId} variant="primary" block loading={busy}>
          Create offering
        </Button>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          const primary = formText(d, "primary");
          void run(async () => {
            const created = await api<typeof offerings.createOffering>(
              "POST",
              "/course-offerings",
              {
                body: {
                  courseId: formText(d, "courseId"),
                  semesterId,
                  sectionCode: formText(d, "sectionCode") || "01",
                  lecturers: primary === "" ? [] : [{ lecturerId: primary, role: "PRIMARY" }],
                },
              },
            );
            await queryClient.invalidateQueries({ queryKey: ["offerings"] });
            onOpenChange(false);
            await navigate({
              to: "/admin/offerings/$offeringId",
              params: { offeringId: created.id },
            });
          });
        }}
      >
        {problem ? (
          <Banner tone="danger" title={problem.title}>
            {problem.body}
          </Banner>
        ) : null}
        {courses.isError || lecturers.isError ? (
          <LoadFailed
            what="the courses and Lecturers"
            onRetry={() => {
              void courses.refetch();
              void lecturers.refetch();
            }}
          />
        ) : null}
        <Select name="courseId" label="Course" required error={fieldErrors.courseId}>
          {courses.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} {c.title}
            </option>
          ))}
        </Select>
        <TextField
          name="sectionCode"
          label="Section"
          defaultValue="01"
          error={fieldErrors.sectionCode}
        />
        <Select name="primary" label="Primary Lecturer">
          <option value="">Choose later</option>
          {lecturers.data?.items
            .filter((l) => l.status === "ACTIVE")
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.displayName}
              </option>
            ))}
        </Select>
      </form>
    </Sheet>
  );
}

/** One offering: who teaches it, publishing and cancelling (TRD §9.4). */
export function AdminOfferingPage() {
  const { offeringId } = useParams({ from: "/admin/offerings/$offeringId" });
  const offering = useQuery(offeringQuery(offeringId));
  useDetailBar({
    back: { to: "/admin/offerings", label: "Course Offerings" },
    ...(offering.data ? { code: offering.data.courseCode } : {}),
  });
  if (offering.isPending)
    return (
      <SkeletonGroup label="Loading the Course Offering">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40" />
      </SkeletonGroup>
    );
  if (offering.isError)
    return isNotAvailable(offering.error) ? (
      <NotAvailable />
    ) : (
      <LoadFailed what="the Course Offering" onRetry={() => void offering.refetch()} />
    );
  return <OfferingDetail offering={offering.data} />;
}

function OfferingDetail({ offering: o }: { offering: Offering }) {
  const lecturers = useQuery(lecturersQuery);
  const queryClient = useQueryClient();
  const { busy, problem, run } = useSubmit();
  const [pending, setPending] = useState<"publish" | "assign" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [removing, setRemoving] = useState<Offering["lecturers"][number] | null>(null);
  const set = (next: Offering): void => {
    queryClient.setQueryData(offeringQuery(o.id).queryKey, next);
  };
  const open = o.status !== "COMPLETED" && o.status !== "CANCELLED";
  const loading = (action: typeof pending) => busy && pending === action;

  return (
    <div className="space-y-5">
      <PageHeader
        overline={`${o.courseCode} · Section ${o.sectionCode}`}
        title={o.title}
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <OfferingBadge status={o.status} />
            <span>
              {o.semesterName}, {o.sessionCode} · {o.credits} credits
            </span>
          </span>
        }
        actions={
          <>
            {o.status === "DRAFT" ? (
              <Button
                variant="primary"
                loading={loading("publish")}
                onClick={() => {
                  setPending("publish");
                  void run(async () => {
                    set(
                      await api<typeof offerings.publishOffering>(
                        "POST",
                        "/course-offerings/:id/publish",
                        { params: { id: o.id } },
                      ),
                    );
                  });
                }}
              >
                Publish
              </Button>
            ) : null}
            {open ? (
              <Button
                variant="danger"
                onClick={() => {
                  setCancelling(true);
                }}
              >
                Cancel offering
              </Button>
            ) : null}
          </>
        }
      />
      {problem ? (
        <Banner tone="danger" title={problem.title}>
          {problem.body}
        </Banner>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-heading">Lecturers</h2>
        {o.lecturers.length === 0 ? (
          <p className="text-body-sm text-ink-muted">No Lecturer is assigned yet.</p>
        ) : (
          <Card list role="list">
            {o.lecturers.map((l) => (
              <div
                key={l.id}
                role="listitem"
                aria-label={l.lecturerName}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-subhead">{l.lecturerName}</p>
                  <p className="text-meta text-ink-muted">{ROLE_LABELS[l.role]}</p>
                </div>
                {open ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setRemoving(l);
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
          </Card>
        )}
        {open ? (
          <form
            className={`${cardClass()} flex flex-col gap-3 md:flex-row md:items-end`}
            onSubmit={(event) => {
              event.preventDefault();
              const d = new FormData(event.currentTarget);
              setPending("assign");
              void run(async () => {
                set(
                  await api<typeof offerings.assignLecturer>(
                    "POST",
                    "/course-offerings/:id/lecturers",
                    {
                      params: { id: o.id },
                      body: {
                        lecturerId: formText(d, "lecturerId"),
                        role: formText(d, "role") as Role,
                      },
                    },
                  ),
                );
              });
            }}
          >
            <div className="md:flex-1">
              <Select name="lecturerId" label="Lecturer">
                {lecturers.data?.items
                  .filter((l) => l.status === "ACTIVE")
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.displayName}
                    </option>
                  ))}
              </Select>
            </div>
            <div className="md:flex-1">
              <Select name="role" label="Role">
                {(Object.entries(ROLE_LABELS) as [Role, string][]).map(([role, label]) => (
                  <option key={role} value={role}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary" loading={loading("assign")}>
              Assign
            </Button>
          </form>
        ) : null}
      </section>

      <Roster offeringId={o.id} open={open} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        title="Remove this Lecturer?"
        confirmLabel="Remove Lecturer"
        tone="danger"
        onConfirm={async () => {
          if (removing === null) return;
          await api<typeof offerings.endAssignment>(
            "DELETE",
            "/course-offerings/:id/lecturers/:assignmentId",
            { params: { id: o.id, assignmentId: removing.id } },
          );
          await queryClient.invalidateQueries({ queryKey: ["offering", o.id] });
          setRemoving(null);
        }}
      >
        {removing?.lecturerName ?? "The Lecturer"} will no longer be assigned to {o.courseCode}{" "}
        {o.title}.
      </ConfirmDialog>
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this offering?"
        confirmLabel="Cancel offering"
        tone="danger"
        reason={{ label: "Why cancel this offering?", minLength: 3 }}
        onConfirm={async (reason) => {
          set(
            await api<typeof offerings.cancelOffering>("POST", "/course-offerings/:id/cancel", {
              params: { id: o.id },
              body: { reason },
            }),
          );
          setCancelling(false);
        }}
      >
        {o.courseCode} {o.title} won't run this semester. This can't be undone.
      </ConfirmDialog>
    </div>
  );
}

/** Who's registered, manual registration (e.g. retakes) and withdrawal, with reasons (§9.3). */
function Roster({ offeringId, open }: { offeringId: string; open: boolean }) {
  const queryClient = useQueryClient();
  const formId = useId();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [registering, setRegistering] = useState(false);
  const [withdrawing, setWithdrawing] = useState<RosterEntry | null>(null);
  const key = ["offerings", offeringId, "roster"];
  const roster = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      api<typeof enrollment.getRoster>("GET", "/course-offerings/:id/enrollments", {
        params: { id: offeringId },
        signal,
      }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const enrolled = roster.data?.items.filter((r) => r.status === "ENROLLED").length ?? 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-heading">Students ({enrolled} enrolled)</h2>
        {open ? (
          <Button
            variant="secondary"
            icon="user"
            onClick={() => {
              setRegistering(true);
            }}
          >
            Register a student
          </Button>
        ) : null}
      </div>
      {roster.isPending ? (
        <SkeletonGroup label="Loading the students">
          <Skeleton className="h-32" />
        </SkeletonGroup>
      ) : roster.isError ? (
        <LoadFailed what="the students" onRetry={() => void roster.refetch()} />
      ) : roster.data.items.length === 0 ? (
        <EmptyState icon="users" title="No students yet" headingLevel={3}>
          Students appear here when they register, or when you register one.
        </EmptyState>
      ) : (
        <DataTable caption="Students" minWidth="min-w-180">
          <thead>
            <tr>
              <th scope="col" className={`${headCell} ${stickyCell}`}>
                Student
              </th>
              <th scope="col" className={headCell}>
                Matric Number
              </th>
              <th scope="col" className={headCell}>
                Level
              </th>
              <th scope="col" className={headCell}>
                How
              </th>
              <th scope="col" className={headCell}>
                Status
              </th>
              <th scope="col" className={headCell}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {roster.data.items.map((r) => (
              <tr key={r.courseEnrollmentId}>
                <td className={`${bodyCell} ${stickyCell}`}>{r.studentName}</td>
                <td className={`${bodyCell} font-mono text-code`}>{r.matricNumber}</td>
                <td className={bodyCell}>Level {r.levelNo}</td>
                <td className={bodyCell}>{SELECTION_LABELS[r.selection]}</td>
                <td className={bodyCell}>
                  <Badge tone={ENROLLMENT_STATUS[r.status].tone}>
                    {ENROLLMENT_STATUS[r.status].word}
                  </Badge>
                </td>
                <td className={bodyCell}>
                  {r.status === "ENROLLED" ? (
                    <Button
                      size="sm"
                      variant="danger"
                      aria-label={`Withdraw ${r.studentName}`}
                      onClick={() => {
                        setWithdrawing(r);
                      }}
                    >
                      Withdraw
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <Sheet
        open={registering}
        onOpenChange={setRegistering}
        title="Register a student"
        description="For a retake or another exception to normal registration."
        footer={
          <Button type="submit" form={formId} variant="primary" block loading={busy}>
            Register student
          </Button>
        }
      >
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void run(async () => {
              await api<typeof enrollment.registerManually>(
                "POST",
                "/course-offerings/:id/enrollments",
                {
                  params: { id: offeringId },
                  body: {
                    matricNumber: formText(data, "matricNumber"),
                    reason: formText(data, "reason"),
                  },
                },
              );
              await refresh();
              setRegistering(false);
            });
          }}
        >
          {problem ? (
            <Banner tone="danger" title={problem.title}>
              {problem.body}
            </Banner>
          ) : null}
          <TextField
            name="matricNumber"
            label="Matric Number"
            required
            error={fieldErrors.matricNumber}
          />
          <TextField
            name="reason"
            label="Reason (e.g. retake)"
            required
            minLength={3}
            error={fieldErrors.reason}
          />
        </form>
      </Sheet>
      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(next) => {
          if (!next) setWithdrawing(null);
        }}
        title={`Withdraw ${withdrawing?.studentName ?? "this student"}?`}
        confirmLabel="Withdraw student"
        tone="danger"
        reason={{
          label: `Why withdraw ${withdrawing?.studentName ?? "this student"}?`,
          minLength: 3,
        }}
        onConfirm={async (reason) => {
          if (withdrawing === null) return;
          await api<typeof enrollment.withdrawCourseEnrollment>(
            "POST",
            "/course-enrollments/:id/withdraw",
            { params: { id: withdrawing.courseEnrollmentId }, body: { reason } },
          );
          await refresh();
          setWithdrawing(null);
        }}
      >
        They are withdrawn from this course. The withdrawal is recorded with your reason.
      </ConfirmDialog>
    </section>
  );
}

/** Lecturer profiles (TRD §16 People). */
export function AdminLecturersPage() {
  const lecturers = useQuery(lecturersQuery);
  const queryClient = useQueryClient();
  const formId = useId();
  const { busy, problem, fieldErrors, run } = useSubmit();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Lecturers"
        meta="Everyone who can be assigned to teach a Course Offering."
        actions={
          <Button
            variant="primary"
            icon="user"
            onClick={() => {
              setNotice(null);
              setAdding(true);
            }}
          >
            Add a Lecturer
          </Button>
        }
      />
      {notice ? <Banner tone="success" title={notice} /> : null}
      {lecturers.isPending ? (
        <SkeletonGroup label="Loading Lecturers">
          <Skeleton className="h-40" />
        </SkeletonGroup>
      ) : lecturers.isError ? (
        <LoadFailed what="the Lecturers" onRetry={() => void lecturers.refetch()} />
      ) : lecturers.data.items.length === 0 ? (
        <EmptyState icon="users" title="No Lecturers yet">
          Add a Lecturer; they get an email invitation to sign in.
        </EmptyState>
      ) : (
        <DataTable caption="Lecturers" minWidth="min-w-160">
          <thead>
            <tr>
              <th scope="col" className={`${headCell} ${stickyCell}`}>
                Name
              </th>
              <th scope="col" className={headCell}>
                Email
              </th>
              <th scope="col" className={headCell}>
                Kind
              </th>
              <th scope="col" className={headCell}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {lecturers.data.items.map((l) => (
              <tr key={l.id}>
                <td className={`${bodyCell} ${stickyCell}`}>{l.displayName}</td>
                <td className={bodyCell}>{l.email}</td>
                <td className={bodyCell}>{l.kind === "GUEST" ? "Guest" : "GLIM staff"}</td>
                <td className={bodyCell}>
                  {l.status === "INACTIVE" ? (
                    <Badge tone="neutral">Inactive</Badge>
                  ) : (
                    <Badge tone="success">Active</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <Sheet
        open={adding}
        onOpenChange={setAdding}
        title="Add a Lecturer"
        description="Someone new is invited by email to set a password."
        footer={
          <Button type="submit" form={formId} variant="primary" block loading={busy}>
            Add Lecturer
          </Button>
        }
      >
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const d = new FormData(event.currentTarget);
            void run(async () => {
              const result = await api<typeof offerings.createLecturer>("POST", "/lecturers", {
                body: {
                  email: formText(d, "email"),
                  title: formText(d, "title") || null,
                  givenName: formText(d, "givenName"),
                  familyName: formText(d, "familyName"),
                  kind: formText(d, "kind") === "GUEST" ? "GUEST" : "INTERNAL",
                },
              });
              setNotice(
                result.invited
                  ? `${result.lecturer.displayName} was invited by email.`
                  : `${result.lecturer.displayName} is now a Lecturer.`,
              );
              setAdding(false);
              await queryClient.invalidateQueries({ queryKey: ["lecturers"] });
            });
          }}
        >
          {problem ? (
            <Banner tone="danger" title={problem.title}>
              {problem.body}
            </Banner>
          ) : null}
          <TextField name="email" type="email" label="Email" required error={fieldErrors.email} />
          <TextField name="title" label="Title (e.g. Rev, Dr)" optional error={fieldErrors.title} />
          <TextField name="givenName" label="Given name" required error={fieldErrors.givenName} />
          <TextField
            name="familyName"
            label="Family name"
            required
            error={fieldErrors.familyName}
          />
          <Select name="kind" label="Kind" error={fieldErrors.kind}>
            <option value="INTERNAL">GLIM staff</option>
            <option value="GUEST">Guest</option>
          </Select>
        </form>
      </Sheet>
    </div>
  );
}
