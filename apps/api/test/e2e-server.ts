import type { StaffRole } from "@glim/contracts";
// The stack Playwright drives (ticket 03): the real API and SPA on a fresh database, with an
// in-memory mailer whose messages are readable on a separate, test-only port.
import "reflect-metadata";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createBoss, createPool, Db } from "@glim/db";
import { createTestDatabase, startTestServices } from "@glim/db/testing";
import { MemoryMailer } from "@glim/integrations/mail/memory";
import { FakeOidcIssuer, type FakeGoogleUser } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
import { S3ObjectStorage } from "@glim/integrations/storage/s3";
import { FAKE_CHANNEL_URL, FakeVideoHost } from "@glim/integrations/video-host/fake";
import { ReactPdfTranscriptRenderer } from "@glim/integrations/pdf/react-pdf";
import {
  CalendarService,
  CoursesService,
  CurriculaService,
  OfferingsService,
  ProgrammesService,
  RoomsService,
} from "@glim/modules/academic";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { AssignmentsService, LecturersService } from "@glim/modules/lecturing";
import { hashPassword, StaffAccountsService } from "@glim/modules/identity";
import { systemClock, unwrap } from "@glim/shared";
import { loadConfig } from "@glim/shared/config";
import { createLogger } from "@glim/telemetry";
import Fastify from "fastify";
import { createHandlers } from "../../worker/src/handlers";
import { createSubscribers } from "../../worker/src/subscribers";
import { startWorker } from "../../worker/src/worker";
import { createWorkerContext } from "../../worker/src/worker.module";
import { buildApp } from "../src/app";
import { bootstrapSystemAdmin } from "./bootstrap";

export const E2E_ADMIN = { email: "e2e-admin@glim.test", displayName: "Esther Admin" };

const services = await startTestServices();
const base = loadConfig();
// The browser uploads straight to this bucket, so presigned URLs (and the CSP) name its server.
const config = {
  ...base,
  storage: { ...base.storage, endpoint: services.s3.endpoint },
  // Lets the integrations spec connect the fake YouTube channel (its grant is sealed with it).
  tokenEncryptionKey: randomBytes(32),
};
const logger = createLogger({ service: "e2e", level: "warn" });
const objectStorage = new S3ObjectStorage({
  endpoint: services.s3.endpoint,
  region: config.storage.region,
  accessKeyId: services.s3.accessKey,
  secretAccessKey: services.s3.secretKey,
});
await objectStorage.ensureBucket(config.storage.bucket);
const database = await createTestDatabase(services.postgresAdminUrl);

const boss = createBoss(database.appUrl, { max: 2 });
boss.on("error", (error) => {
  logger.warn({ err: error }, "pg-boss error");
});
await boss.start();
const db = new Db(createPool(database.appUrl, 4), boss);
const mailer = new MemoryMailer();
// Stands in for accounts.google.com; specs queue who signs in next through the mailbox port.
const google = await new FakeOidcIssuer().start();
// YouTube is faked end to end: every well-formed link is an available video on GLIM's channel.
const videoHost = new FakeVideoHost();
const app = await buildApp({
  config,
  db,
  boss,
  clock: systemClock,
  logger,
  mailer,
  identityProvider: new OpenIdConnectProvider({
    issuer: google.issuerUrl,
    clientId: google.clientId,
    clientSecret: google.clientSecret,
    allowHttp: true,
  }),
  objectStorage,
  videoHost,
  transcriptRenderer: new ReactPdfTranscriptRenderer(),
  staticDir: fileURLToPath(new URL("../../web/dist", import.meta.url)),
});
await bootstrapSystemAdmin(app, E2E_ADMIN);
// More invited staff, so each spec starts from its own account and none depends on another.
const E2E_STAFF: [email: string, displayName: string, role: StaffRole][] = [
  ["e2e-ops@glim.test", "Obi Ops", "SYSTEM_ADMIN"],
  ["e2e-google@glim.test", "Gloria Google", "REGISTRAR"],
  ["e2e-settings@glim.test", "Sade Settings", "SYSTEM_ADMIN"],
  ["e2e-academic@glim.test", "Ade Academic", "ACADEMIC_ADMIN"],
  ["e2e-admissions@glim.test", "Amaka Admissions", "ADMISSIONS_OFFICER"],
  ["e2e-imports@glim.test", "Ike Imports", "ACADEMIC_ADMIN"],
  ["e2e-videos@glim.test", "Vera Videos", "SYSTEM_ADMIN"],
  ["e2e-registrar@glim.test", "Remi Registrar", "REGISTRAR"],
  ["e2e-opspage@glim.test", "Opal Ops", "SYSTEM_ADMIN"],
  ["e2e-integrations@glim.test", "Ina Integrations", "SYSTEM_ADMIN"],
];
for (const [email, displayName, role] of E2E_STAFF) {
  await app
    .get(StaffAccountsService)
    .inviteStaff({ email, displayName, roles: [role] }, SYSTEM_ACTOR);
}
// A programme applicants can choose, and a planned Academic Session for the admissions spec's intake.
const ministry = unwrap(
  await app.get(ProgrammesService).create(
    {
      code: "DMIN",
      name: "Diploma in Ministry",
      awardType: "DIPLOMA",
      durationSemesters: 4,
      levels: 2,
    },
    SYSTEM_ACTOR,
  ),
);
// Students enroll on the programme's active curriculum when they accept an offer.
const pastoral = unwrap(
  await app
    .get(CoursesService)
    .create(
      { code: "PAS101", title: "Pastoral Care", description: null, credits: "3.0" },
      SYSTEM_ACTOR,
    ),
);
const curricula = app.get(CurriculaService);
const draft = unwrap(
  await curricula.create(
    { programmeId: ministry.id, effectiveFrom: "2030-09-01", minElectiveCredits: "0.0" },
    SYSTEM_ACTOR,
  ),
);
unwrap(
  await curricula.replacePlacements(
    draft.id,
    draft.version,
    [
      {
        courseId: pastoral.id,
        levelNo: 1,
        semesterNo: 1,
        courseType: "COMPULSORY",
        creditOverride: null,
      },
    ],
    SYSTEM_ACTOR,
  ),
);
unwrap(await curricula.activate(draft.id, SYSTEM_ACTOR));
await app
  .get(CalendarService)
  .createSession(
    { code: "2030/2031", name: "2030/2031 Session", startsOn: "2030-09-01", endsOn: "2031-06-30" },
    SYSTEM_ACTOR,
  );
// A Lecturer (invited) teaching a published offering, and a Room, for the Class Meeting spec.
// Its own session, so the admissions spec's session stays untouched.
const calendar = app.get(CalendarService);
const teachingSession = unwrap(
  await calendar.createSession(
    { code: "2032/2033", name: "2032/2033 Session", startsOn: "2032-09-01", endsOn: "2033-06-30" },
    SYSTEM_ACTOR,
  ),
);
const teachingSemester = unwrap(
  await calendar.createSemester(
    {
      academicSessionId: teachingSession.id,
      code: "S1",
      name: "First Semester",
      sequence: 1,
      startsOn: "2032-09-06",
      endsOn: "2033-01-28",
    },
    SYSTEM_ACTOR,
  ),
);
unwrap(
  await app
    .get(RoomsService)
    .create({ code: "CHAPEL", name: "Chapel", capacity: 60 }, SYSTEM_ACTOR),
);
const { lecturer: e2eLecturer } = unwrap(
  await app.get(LecturersService).create(
    {
      email: "e2e-lecturer@glim.test",
      title: "Rev",
      givenName: "Lola",
      familyName: "Lecturer",
      kind: "INTERNAL",
      staffCode: null,
    },
    SYSTEM_ACTOR,
  ),
);
const { lecturer: e2eRollCaller } = unwrap(
  await app.get(LecturersService).create(
    {
      email: "e2e-rollcall@glim.test",
      title: null,
      givenName: "Remi",
      familyName: "Rollcall",
      kind: "INTERNAL",
      staffCode: null,
    },
    SYSTEM_ACTOR,
  ),
);
const teachingOffering = unwrap(
  await app.get(AssignmentsService).createOfferingWithLecturers(
    {
      courseId: pastoral.id,
      semesterId: teachingSemester.id,
      sectionCode: "01",
      titleOverride: null,
      capacity: null,
      lecturers: [
        { lecturerId: e2eLecturer.id, role: "PRIMARY" },
        { lecturerId: e2eRollCaller.id, role: "CO_LECTURER" },
      ],
    },
    SYSTEM_ACTOR,
  ),
);
unwrap(await app.get(OfferingsService).publish(teachingOffering, SYSTEM_ACTOR));
// Two students on that offering, one on campus and one online, for the roll-call spec. The
// online one can sign in, to watch recordings (recordings spec).
const studentPassword = await hashPassword("student passphrase 2026");
for (const [n, given, family, mode] of [
  [1, "Ada", "Campus", "ON_CAMPUS"],
  [2, "Bola", "Online", "ONLINE"],
] as const) {
  const one = async (text: string, values: unknown[]) =>
    (await db.pool.query<{ id: string }>(text, values)).rows[0]?.id;
  const userId = await one(
    "INSERT INTO users (email, display_name, status, password_hash) VALUES ($1, $2, 'ACTIVE', $3) RETURNING id",
    [`e2e-student${String(n)}@glim.test`, `${given} ${family}`, n === 2 ? studentPassword : null],
  );
  const studentId = await one(
    "INSERT INTO students (user_id, given_name, family_name) VALUES ($1, $2, $3) RETURNING id",
    [userId, given, family],
  );
  const enrollmentId = await one(
    `INSERT INTO programme_enrollments (student_id, programme_id, curriculum_id, entry_session_id, matric_number, study_mode, started_on)
     VALUES ($1, $2, $3, $4, $5, $6, '2032-09-01') RETURNING id`,
    [studentId, ministry.id, draft.id, teachingSession.id, `GLIM/DIP/2032/000${String(n)}`, mode],
  );
  const semesterEnrollmentId = await one(
    "INSERT INTO semester_enrollments (programme_enrollment_id, semester_id, level_no) VALUES ($1, $2, 1) RETURNING id",
    [enrollmentId, teachingSemester.id],
  );
  await db.pool.query(
    `INSERT INTO course_enrollments (semester_enrollment_id, programme_enrollment_id, course_offering_id, student_id, selection, status)
     VALUES ($1, $2, $3, $4, 'COMPULSORY', 'ENROLLED')`,
    [semesterEnrollmentId, enrollmentId, teachingOffering, studentId],
  );
}
// Recordings may come from the fake YouTube's channel.
await db.pool.query("UPDATE settings SET youtube_channel_urls = $1", [[FAKE_CHANNEL_URL]]);
// The Diploma in Ministry is graded with the seeded GLIM Diploma scheme (the results spec finalizes).
await db.pool.query(
  "UPDATE programmes SET grading_scheme_id = (SELECT id FROM grading_schemes WHERE name = 'GLIM Diploma') WHERE id = $1",
  [ministry.id],
);
await app.listen(config.port, "127.0.0.1");

// The worker runs in-process on the general queues (no cron), so queued emails are sent.
const workerBoss = createBoss(database.appUrl, { max: 2, supervise: false, schedule: false });
const workerContext = await createWorkerContext({
  db: new Db(createPool(database.appUrl, 2), workerBoss),
  clock: systemClock,
  logger,
  config,
  mailer,
  objectStorage,
  videoHost,
});
const worker = await startWorker({
  boss: workerBoss,
  role: "general",
  handlers: createHandlers({
    context: workerContext,
    subscribers: createSubscribers(workerContext),
  }),
  logger,
  pollingIntervalSeconds: 0.5,
});

const mailbox = Fastify();
mailbox.get<{ Querystring: { to: string } }>("/last", (req, reply) => {
  const message = mailer.lastTo(req.query.to);
  return message ? message : reply.status(404).send({});
});
mailbox.post<{ Body: FakeGoogleUser }>("/google/next", (req, reply) => {
  google.nextSignIn(req.body);
  return reply.status(204).send();
});
// Scripts what the fake YouTube says about a video (e.g. that it was deleted).
mailbox.post<{
  Body: { videoId: string; status: "AVAILABLE" | "PRIVATE_OR_RESTRICTED" | "NOT_FOUND" };
}>("/youtube/script", (req, reply) => {
  videoHost.script(
    req.body.videoId,
    req.body.status === "AVAILABLE"
      ? {
          status: "AVAILABLE",
          title: `Fake video ${req.body.videoId}`,
          channelUrl: FAKE_CHANNEL_URL,
        }
      : { status: req.body.status },
  );
  return reply.status(204).send();
});
await mailbox.listen({ port: config.port + 1, host: "127.0.0.1" });
logger.warn({ port: config.port }, "e2e stack ready");

async function shutdown(): Promise<void> {
  await mailbox.close();
  await worker.stop({ graceful: false });
  await workerContext.close();
  await app.close();
  await boss.stop({ graceful: false });
  await db.pool.end();
  await database.drop();
  await services.stop();
  await google.stop();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
