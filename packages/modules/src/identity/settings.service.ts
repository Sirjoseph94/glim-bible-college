import { Db, schema } from "@glim/db";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

export interface Institution {
  name: string;
  timezone: string;
}

/** Reads and changes the single-row institution settings (owner: identity, ADR-0001). */
@Injectable()
export class SettingsService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async getInstitution(): Promise<Institution> {
    const [row] = await this.db.read
      .select({ name: schema.settings.name, timezone: schema.settings.timezone })
      .from(schema.settings)
      .where(eq(schema.settings.id, 1));
    if (row === undefined) throw new Error("The settings row is missing; run the migrations.");
    return row;
  }

  /** Google `hd` domains staff must sign in from; empty means no restriction (§8.1). */
  async getStaffEmailDomains(): Promise<string[]> {
    const [row] = await this.db.read
      .select({ domains: schema.settings.staffEmailDomains })
      .from(schema.settings)
      .where(eq(schema.settings.id, 1));
    return (row?.domains ?? []).map((d) => d.toLowerCase());
  }
}
