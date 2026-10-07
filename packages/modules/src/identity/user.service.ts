import type { EnumValue } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { domainError, err, ok, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";

export type UserStatus = EnumValue<"users.status">;

/** Someone the college writes to. */
export interface Recipient {
  email: string;
  displayName: string;
}

export interface UserProfile extends Recipient {
  id: string;
  status: UserStatus;
  timezone: string | null;
}

/** Users (owner: identity, §6.2). */
@Injectable()
export class UserService {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** A staff member starts INVITED and becomes ACTIVE when they accept the invite (§8.2). */
  async createInvitedUser(db: Database, input: Recipient): Promise<DomainResult<UserProfile>> {
    const [row] = await db
      .insert(schema.users)
      .values({
        email: input.email.trim(),
        displayName: input.displayName.trim(),
        status: "INVITED",
      })
      .onConflictDoNothing({ target: schema.users.email })
      .returning();
    if (row === undefined)
      return err(domainError("CONFLICT", "A user with this email already exists."));
    return ok(toProfile(row));
  }

  /** A user changes their own display name or timezone (§5.1: set from the browser on first sign-in). */
  async updateOwnProfile(
    id: string,
    change: { displayName?: string | undefined; timezone?: string | undefined },
  ): Promise<void> {
    if (change.displayName === undefined && change.timezone === undefined) return;
    await this.db.withTx(({ db }) =>
      db
        .update(schema.users)
        .set({
          ...(change.displayName === undefined ? {} : { displayName: change.displayName }),
          ...(change.timezone === undefined ? {} : { timezone: change.timezone }),
          version: sql`${schema.users.version} + 1`,
        })
        .where(eq(schema.users.id, id)),
    );
  }

  async findByEmail(email: string, db: Database = this.db.read): Promise<UserProfile | null> {
    const [row] = await db.select().from(schema.users).where(eq(schema.users.email, email.trim()));
    return row === undefined ? null : toProfile(row);
  }

  async findById(id: string): Promise<UserProfile | null> {
    const [row] = await this.db.read.select().from(schema.users).where(eq(schema.users.id, id));
    return row === undefined ? null : toProfile(row);
  }
}

export function toProfile(row: schema.UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status as UserStatus,
    timezone: row.timezone,
  };
}
