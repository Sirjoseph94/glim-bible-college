import { DOMAIN_EVENTS, type ApplicationStatus, type DomainEventName } from "@glim/contracts";
import { schema, type Tx } from "@glim/db";
import type { AuditActor, AuditService } from "@glim/modules/audit";

/** The audit action for each status an application moves to (§10.3). */
const VERBS: Partial<Record<ApplicationStatus, string>> = {
  SUBMITTED: "submitted",
  UNDER_REVIEW: "review-started",
  ADMITTED: "admitted",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
  ACCEPTED: "accepted",
};

/**
 * Every application transition writes an application event, an audit row and, where one is
 * defined, a domain event, in the caller's transaction (§10.3, INV-11). `metadata` must never
 * hold sensitive answers or the internal decision note (INV-15).
 */
export async function recordTransition(
  tx: Tx,
  audit: AuditService,
  input: {
    applicationId: string;
    from: string;
    to: ApplicationStatus;
    actor: AuditActor & { userId: string | null };
    now: Date;
    metadata?: Record<string, string>;
  },
): Promise<void> {
  const verb = VERBS[input.to];
  if (verb === undefined) throw new Error(`No transition is recorded for ${input.to}`);
  const metadata = input.metadata ?? {};
  await tx.db.insert(schema.applicationEvents).values({
    applicationId: input.applicationId,
    fromStatus: input.from,
    toStatus: input.to,
    actorUserId: input.actor.userId,
    createdAt: input.now,
  });
  await audit.record(tx.db, input.actor, {
    action: `admissions.application.${verb}`,
    resourceType: "application",
    resourceId: input.applicationId,
    metadata: { from: input.from, ...metadata },
  });
  const event = `admissions.application.${verb}`;
  if ((DOMAIN_EVENTS as readonly string[]).includes(event))
    await tx.boss.publish(
      event as DomainEventName,
      { applicationId: input.applicationId, ...metadata },
      { occurredAt: input.now, actorUserId: input.actor.userId },
    );
}
