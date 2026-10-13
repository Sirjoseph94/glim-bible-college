import type { DomainEvent, DomainEventName } from "@glim/contracts";
import { Db } from "@glim/db";
import { AttendanceService } from "@glim/modules/attendance";
import { ProvisioningService } from "@glim/modules/class-meeting";
import { TranscriptsService } from "@glim/modules/transcripts";
import type { INestApplicationContext } from "@nestjs/common";

/** An idempotent reaction to a domain event (TRD §17.3). Delivery is at-least-once. */
export type Subscriber = (event: DomainEvent) => Promise<void>;

export type SubscriberRegistry = Partial<Record<DomainEventName, Subscriber[]>>;

/**
 * Subscribers for the modules' domain events. Long work is handed to its own queue rather than
 * done in the subscriber, so it gets that queue's retry and expiry (§17.2).
 */
export function createSubscribers(context: INestApplicationContext): SubscriberRegistry {
  const db = context.get(Db);
  const attendance = context.get(AttendanceService);
  const transcripts = context.get(TranscriptsService);
  const provisioning = context.get(ProvisioningService);
  // Who may join without knocking follows the course's students and Lecturers (§11.5).
  const resync = async (event: DomainEvent) => {
    const p = event.payload as { courseOfferingId?: string; offeringId?: string };
    const offeringId = p.courseOfferingId ?? p.offeringId;
    if (offeringId !== undefined) await provisioning.queueSyncForOffering(offeringId);
  };
  return {
    "course.enrollment.activated": [resync],
    "course.enrollment.ended": [resync],
    "lecturing.assignment.created": [resync],
    "lecturing.assignment.ended": [resync],
    // Year 1 → Year 2 progression when an Academic Session is activated (§9.1, D-03).
    "academic.session.activated": [
      async (event) => {
        const { sessionId } = event.payload as { sessionId: string };
        await db.withTx(({ boss }) => boss.send("academic.progression", { sessionId }));
      },
    ],
    // A class that ended is finalized after the finalize delay (§12.6).
    "meeting.ended": [
      async (event) => {
        const { meetingId } = event.payload as { meetingId: string };
        await db.withTx(({ boss }) => attendance.queueFinalize(boss, meetingId));
      },
    ],
    // A reopened result supersedes the issued transcripts that show it (§14.3).
    "results.course.reopened": [
      async (event) => {
        const p = event.payload as {
          programmeEnrollmentId: string;
          courseCode: string;
          sessionCode: string;
          semesterName: string;
          reason: string;
        };
        await transcripts.supersedeFor({ ...p, reason: `Result reopened: ${p.reason}` });
      },
    ],
    // Semester results are computed when the semester closes (§14.5).
    "academic.semester.closed": [
      async (event) => {
        const { semesterId } = event.payload as { semesterId: string };
        await db.withTx(({ boss }) => boss.send("results.compute-semester", { semesterId }));
      },
    ],
    // Compulsory courses are registered when a semester opens registration (§9.3).
    "academic.semester.registration-opened": [
      async (event) => {
        const { semesterId } = event.payload as { semesterId: string };
        await db.withTx(({ boss }) => boss.send("semester.open-registration", { semesterId }));
      },
    ],
  };
}

/** Runs every subscriber for the event; a failure fails the job so pg-boss retries it. */
export function createDispatcher(registry: SubscriberRegistry) {
  return async (event: DomainEvent): Promise<void> => {
    for (const subscriber of registry[event.name] ?? []) {
      await subscriber(event);
    }
  };
}
