import { Db, schema } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  ok,
  toLocalDate,
  type Clock,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

export interface Institution {
  name: string;
  timezone: string;
}

export interface InstitutionSettings extends Institution {
  staffEmailDomains: string[];
  statementOfFaithUrl: string | null;
  youtubeChannelUrls: string[];
  version: number;
  updatedAt: Date;
}

export interface SettingsChange {
  name?: string | undefined;
  timezone?: string | undefined;
  staffEmailDomains?: string[] | undefined;
  statementOfFaithUrl?: string | null | undefined;
  youtubeChannelUrls?: string[] | undefined;
}

/** Reads and changes the single-row institution settings (owner: identity, ADR-0001). */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async getInstitution(): Promise<Institution> {
    const { name, timezone } = await this.get();
    return { name, timezone };
  }

  /** Today's date in the institution's timezone (§5.1: calendar dates are institution dates). */
  async today(): Promise<string> {
    return toLocalDate(this.clock.now(), (await this.getInstitution()).timezone);
  }

  /** Google `hd` domains staff must sign in from; empty means no restriction (§8.1). */
  async getStaffEmailDomains(): Promise<string[]> {
    return (await this.get()).staffEmailDomains.map((d) => d.toLowerCase());
  }

  async get(): Promise<InstitutionSettings> {
    const [row] = await this.db.read
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.id, 1));
    if (row === undefined) throw new Error("The settings row is missing; run the migrations.");
    const { id: _id, ...settings } = row;
    return settings;
  }

  /** Optimistic concurrency on the settings version (§5.4); every change is audited. */
  async update(
    expectedVersion: number,
    change: SettingsChange,
    actor: AuditActor,
  ): Promise<DomainResult<InstitutionSettings>> {
    const before = await this.get();
    const changed = (Object.keys(change) as (keyof SettingsChange)[]).filter(
      (key) =>
        change[key] !== undefined && JSON.stringify(change[key]) !== JSON.stringify(before[key]),
    );
    const result = await this.db.withTxResult(async ({ db }) => {
      const s = schema.settings;
      const [row] = await db
        .update(s)
        .set({
          ...definedFields(change),
          updatedAt: this.clock.now(),
          version: sql`${s.version} + 1`,
        })
        .where(and(eq(s.id, 1), eq(s.version, expectedVersion)))
        .returning({ id: s.id });
      if (row === undefined) {
        return err(
          domainError(
            "VERSION_MISMATCH",
            "Someone else changed the settings. Reload and try again.",
          ),
        );
      }
      await this.audit.record(db, actor, {
        action: "identity.settings.updated",
        resourceType: "settings",
        resourceId: "institution",
        metadata: Object.fromEntries(
          changed.map((key) => [key, { from: before[key], to: change[key] }]),
        ),
      });
      return ok(null);
    });
    return result.ok ? ok(await this.get()) : result;
  }
}
