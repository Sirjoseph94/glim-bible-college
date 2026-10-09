import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { meQuery } from "./api/session";
import { LoginPage } from "./routes/login";
import { RootLayout } from "./routes/root";

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: RootLayout });

// Every page is its own chunk (TRD §18.1); only the shell is in the initial bundle.
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async ({ context }) => {
    if ((await context.queryClient.query(meQuery)) === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/home"), "HomePage"),
});

const signedOutOnly = async ({ context }: { context: RouterContext }) => {
  if ((await context.queryClient.query(meQuery)) !== null) throw redirect({ to: "/" });
};

/** `?error=` from the Google callback (contracts: GOOGLE_FAILURES), shown on arrival. */
const errorSearch = (search: Record<string, unknown>): { error?: string } =>
  typeof search.error === "string" ? { error: search.error } : {};

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: errorSearch,
  beforeLoad: signedOutOnly,
  // The sign-in page is the first screen, so it ships in the entry chunk (TRD §18.3).
  component: LoginPage,
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profile",
  validateSearch: (search: Record<string, unknown>): { error?: string; linked?: string } => ({
    ...errorSearch(search),
    ...(typeof search.linked === "string" ? { linked: search.linked } : {}),
  }),
  beforeLoad: async ({ context }) => {
    if ((await context.queryClient.query(meQuery)) === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/profile"), "ProfilePage"),
});

const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot",
  component: lazyRouteComponent(() => import("./routes/forgot"), "ForgotPage"),
});

const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset/$token",
  component: lazyRouteComponent(() => import("./routes/reset"), "ResetPage"),
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: lazyRouteComponent(() => import("./routes/invite"), "InvitePage"),
});

/** Staff screens: the server authorizes every call; this only keeps the UI tidy (INV-1). */
const requireRole =
  (...roles: string[]) =>
  async ({ context }: { context: RouterContext }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
    if (!me.roles.staff.some((r) => roles.includes(r))) throw redirect({ to: "/" });
  };

const adminUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/users",
  beforeLoad: requireRole("SYSTEM_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-users"), "AdminUsersPage"),
});

const adminUserRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/users/$userId",
  beforeLoad: requireRole("SYSTEM_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-user"), "AdminUserPage"),
});

const adminVideosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/videos",
  beforeLoad: requireRole("SYSTEM_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-videos"), "AdminVideosPage"),
});

const adminOpsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/ops",
  beforeLoad: requireRole("SYSTEM_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-ops"), "AdminOpsPage"),
});

const adminJobsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/jobs",
  beforeLoad: requireRole("SYSTEM_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-ops"), "AdminJobsPage"),
});

const adminAuditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/audit",
  beforeLoad: requireRole("SYSTEM_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-audit"), "AdminAuditPage"),
});

const adminSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/settings",
  beforeLoad: requireRole("SYSTEM_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-settings"), "AdminSettingsPage"),
});

const adminAcademicRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/academic",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ACADEMIC_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-academic"), "AdminAcademicPage"),
});

const adminCurriculumRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/curricula/$curriculumId",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ACADEMIC_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-curriculum"), "AdminCurriculumPage"),
});

const adminImportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/imports",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ACADEMIC_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-imports"), "AdminImportsPage"),
});

const adminGradingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/grading-schemes",
  beforeLoad: requireRole("SYSTEM_ADMIN", "REGISTRAR"),
  component: lazyRouteComponent(() => import("./routes/admin-grading"), "AdminGradingPage"),
});

const adminCalendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/calendar",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ACADEMIC_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-calendar"), "AdminCalendarPage"),
});

const adminOfferingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/offerings",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ACADEMIC_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-offerings"), "AdminOfferingsPage"),
});

const adminOfferingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/offerings/$offeringId",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ACADEMIC_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-offerings"), "AdminOfferingPage"),
});

const adminLecturersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/lecturers",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ACADEMIC_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/admin-offerings"), "AdminLecturersPage"),
});

const requireStudent = async ({ context }: { context: RouterContext }) => {
  const me = await context.queryClient.query(meQuery);
  if (me === null) throw redirect({ to: "/login" });
  if (!me.roles.isStudent) throw redirect({ to: "/" });
};

/** Students, and graduates, who keep their results and transcripts. */
const requireStudentOrAlumnus = async ({ context }: { context: RouterContext }) => {
  const me = await context.queryClient.query(meQuery);
  if (me === null) throw redirect({ to: "/login" });
  if (!me.roles.isStudent && !me.roles.isAlumnus) throw redirect({ to: "/" });
};

const registrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/registration",
  beforeLoad: requireStudent,
  component: lazyRouteComponent(() => import("./routes/student"), "RegistrationPage"),
});

const coursesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/courses",
  beforeLoad: requireStudent,
  component: lazyRouteComponent(() => import("./routes/student"), "CoursesPage"),
});

const teachRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/teach",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
    if (!me.roles.isLecturer) throw redirect({ to: "/" });
  },
  component: lazyRouteComponent(() => import("./routes/teach"), "TeachPage"),
});

const rollCallRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/teach/meetings/$meetingId/roll-call",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/roll-call"), "RollCallPage"),
});

const meetingAttendanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/teach/meetings/$meetingId/attendance",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/roll-call"), "MeetingAttendancePage"),
});

const recordingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recordings/$videoId",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/recording"), "RecordingPage"),
});

const assignmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assignments/$assignmentId",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/assignment"), "AssignmentPage"),
});

const gradeAssignmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/teach/assignments/$assignmentId/grade",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/assignment"), "GradeAssignmentPage"),
});

const quizRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/quizzes/$quizId",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/quiz"), "QuizPage"),
});

const quizGradingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/teach/quizzes/$quizId/grade",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/quiz"), "QuizGradingPage"),
});

const gradebookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/teach/offerings/$offeringId/gradebook",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/gradebook"), "GradebookPage"),
});

const courseResultsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/course-results/$offeringId",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/results"), "CourseResultsPage"),
});

const resultsCoursesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/results/courses",
  beforeLoad: requireRole("SYSTEM_ADMIN", "REGISTRAR", "ACADEMIC_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/results"), "ResultsCoursesPage"),
});

const semesterResultsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/results/semesters",
  beforeLoad: requireRole("SYSTEM_ADMIN", "REGISTRAR", "ACADEMIC_ADMIN"),
  component: lazyRouteComponent(() => import("./routes/results"), "SemesterResultsPage"),
});

const awardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/results/awards",
  beforeLoad: requireRole("SYSTEM_ADMIN", "REGISTRAR"),
  component: lazyRouteComponent(() => import("./routes/awards"), "AwardsPage"),
});

const myResultsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/results",
  beforeLoad: requireStudentOrAlumnus,
  component: lazyRouteComponent(() => import("./routes/results"), "MyResultsPage"),
});

const myTranscriptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transcripts",
  beforeLoad: requireStudentOrAlumnus,
  component: lazyRouteComponent(() => import("./routes/transcripts"), "MyTranscriptsPage"),
});

const transcriptRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transcripts/$transcriptId",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/transcripts"), "TranscriptPage"),
});

const registrarTranscriptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/results/transcripts",
  beforeLoad: requireRole("SYSTEM_ADMIN", "REGISTRAR"),
  component: lazyRouteComponent(() => import("./routes/transcripts"), "RegistrarTranscriptsPage"),
});

/** Public: anyone holding a transcript can check it (§14.7). */
const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify/$code",
  component: lazyRouteComponent(() => import("./routes/transcripts"), "VerifyPage"),
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.query(meQuery);
    if (me === null) throw redirect({ to: "/login" });
  },
  component: lazyRouteComponent(() => import("./routes/notifications"), "NotificationsPage"),
});

const applyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apply",
  validateSearch: errorSearch,
  component: lazyRouteComponent(() => import("./routes/apply"), "ApplyPage"),
});

const signedInOrApply = async ({ context }: { context: RouterContext }) => {
  if ((await context.queryClient.query(meQuery)) === null) throw redirect({ to: "/apply" });
};

/** The applicant's status page (reference number, timeline, withdraw). */
const applicationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/application",
  beforeLoad: signedInOrApply,
  component: lazyRouteComponent(() => import("./routes/application"), "ApplicationPage"),
});

/** The applicant's wizard; anyone signed in may start an application, so no role is needed. */
const applicationEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/application/edit",
  beforeLoad: signedInOrApply,
  component: lazyRouteComponent(() => import("./routes/application-edit"), "ApplicationEditPage"),
});

const admissionsQueueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admissions",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ADMISSIONS_OFFICER"),
  component: lazyRouteComponent(() => import("./routes/admissions-queue"), "AdmissionsQueuePage"),
});

const admissionsReportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admissions/reports",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ADMISSIONS_OFFICER"),
  component: lazyRouteComponent(
    () => import("./routes/admissions-reports"),
    "AdmissionsReportsPage",
  ),
});

const admissionsApplicationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admissions/applications/$applicationId",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ADMISSIONS_OFFICER"),
  component: lazyRouteComponent(
    () => import("./routes/admissions-application"),
    "AdmissionsApplicationPage",
  ),
});

const admissionsIntakesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admissions/intakes",
  beforeLoad: requireRole("SYSTEM_ADMIN", "ADMISSIONS_OFFICER"),
  component: lazyRouteComponent(
    () => import("./routes/admissions-intakes"),
    "AdmissionsIntakesPage",
  ),
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  rollCallRoute,
  meetingAttendanceRoute,
  recordingRoute,
  assignmentRoute,
  gradeAssignmentRoute,
  quizRoute,
  quizGradingRoute,
  gradebookRoute,
  courseResultsRoute,
  resultsCoursesRoute,
  semesterResultsRoute,
  awardsRoute,
  myTranscriptsRoute,
  transcriptRoute,
  registrarTranscriptsRoute,
  verifyRoute,
  notificationsRoute,
  myResultsRoute,
  adminVideosRoute,
  loginRoute,
  forgotRoute,
  resetRoute,
  inviteRoute,
  profileRoute,
  adminUsersRoute,
  adminUserRoute,
  adminAuditRoute,
  adminOpsRoute,
  adminJobsRoute,
  adminSettingsRoute,
  adminAcademicRoute,
  adminCurriculumRoute,
  adminCalendarRoute,
  adminOfferingsRoute,
  adminOfferingRoute,
  adminLecturersRoute,
  teachRoute,
  registrationRoute,
  coursesRoute,
  applyRoute,
  applicationRoute,
  applicationEditRoute,
  adminImportsRoute,
  adminGradingRoute,
  admissionsQueueRoute,
  admissionsReportsRoute,
  admissionsApplicationRoute,
  admissionsIntakesRoute,
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: false });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
