import { POLICY_SCHEMAS, type EditablePolicyType, type PolicyConfig } from "@glim/contracts";
import { Db, schema } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";

export interface PolicyVersion<T extends EditablePolicyType = EditablePolicyType> {
  type: T;
  /** 0 when nothing has been saved and the defaults apply. */
  version: number;
  config: PolicyConfig<T>;
  effectiveFrom: Date | null;
  createdBy: string | null;
}

/**
 * Versioned, append-only institution policies (§6.2). Every module reads its rules through
 * `current`, which always returns a complete config: stored values over today's defaults.
 */
@Injectable()
export class PolicyService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async current<T extends EditablePolicyType>(type: T): Promise<PolicyVersion<T>> {
    const p = schema.policies;
    const [row] = await this.db.read
      .select()
      .from(p)
      .where(and(eq(p.policyType, type), eq(p.scopeType, "INSTITUTION"), isNull(p.scopeId)))
      .orderBy(desc(p.policyVersion))
      .limit(1);
    return {
      type,
      version: row?.policyVersion ?? 0,
      config: POLICY_SCHEMAS[type].parse(row?.config ?? {}) as PolicyConfig<T>,
      effectiveFrom: row?.effectiveFrom ?? null,
      createdBy: row?.createdBy ?? null,
    };
  }

  /** Saves the next version. `expectedVersion` is the version the editor started from (§5.4). */
  async save<T extends EditablePolicyType>(
    type: T,
    expectedVersion: number,
    config: unknown,
    actor: AuditActor,
  ): Promise<DomainResult<PolicyVersion<T>>> {
    const parsed = POLICY_SCHEMAS[type].safeParse(config);
    if (!parsed.success) {
      return err(
        domainError("VALIDATION_FAILED", "The policy is invalid.", {
          fieldErrors: parsed.error.issues.map((i) => ({
            path: ["body", "config", ...i.path.map(String)].join("."),
            code: i.code,
            message: i.message,
          })),
        }),
      );
    }
    const current = await this.current(type);
    if (current.version !== expectedVersion) {
      return err(
        domainError("VERSION_MISMATCH", "Someone else changed this policy. Reload and try again."),
      );
    }
    const now = this.clock.now();
    const version = expectedVersion + 1;
    try {
      await this.db.withTx(async ({ db }) => {
        await db.insert(schema.policies).values({
          policyType: type,
          policyVersion: version,
          config: parsed.data,
          effectiveFrom: now,
          createdBy: actor.userId,
          createdAt: now,
        });
        await this.audit.record(db, actor, {
          action: "identity.policy.saved",
          resourceType: "policy",
          resourceId: type,
          metadata: { version },
        });
      });
    } catch (error) {
      // The unique (type, scope, version) index makes a concurrent save of the same version fail.
      if (isUniqueViolation(error)) {
        return err(
          domainError(
            "VERSION_MISMATCH",
            "Someone else changed this policy. Reload and try again.",
          ),
        );
      }
      throw error;
    }
    return ok({
      type,
      version,
      config: parsed.data as PolicyConfig<T>,
      effectiveFrom: now,
      createdBy: actor.userId,
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error && "cause" in error ? error.cause : error;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505";
}
