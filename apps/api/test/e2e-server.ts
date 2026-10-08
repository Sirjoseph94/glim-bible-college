import type { StaffRole } from "@glim/contracts";
// The stack Playwright drives (ticket 03): the real API and SPA on a fresh database, with an
// in-memory mailer whose messages are readable on a separate, test-only port.
import "reflect-metadata";
import { fileURLToPath } from "node:url";
import { createBoss, createPool, Db } from "@glim/db";
import { createTestDatabase, startTestServices } from "@glim/db/testing";
import { MemoryMailer } from "@glim/integrations/mail/memory";
import { FakeOidcIssuer, type FakeGoogleUser } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
import { S3ObjectStorage } from "@glim/integrations/storage/s3";
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
import { StaffAccountsService } from "@glim/modules/identity";
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
const config = { ...base, storage: { ...base.storage, endpoint: services.s3.endpoint } };
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
await boss.start();
const db = new Db(createPool(database.appUrl, 4), boss);
const mailer = new MemoryMailer();
// Stands in for accounts.google.com; specs queue who signs in next through the mailbox port.
const google = await new FakeOidcIssuer().start();
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
const teachingOffering = unwrap(
  await app.get(AssignmentsService).createOfferingWithLecturers(
    {
      courseId: pastoral.id,
      semesterId: teachingSemester.id,
      sectionCode: "01",
      titleOverride: null,
      capacity: null,
      lecturers: [{ lecturerId: e2eLecturer.id, role: "PRIMARY" }],
    },
    SYSTEM_ACTOR,
  ),
);
unwrap(await app.get(OfferingsService).publish(teachingOffering, SYSTEM_ACTOR));
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
