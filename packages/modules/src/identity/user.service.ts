import { Db, schema, type Database } from "@glim/db";
import { AppError } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  status: string;
  timezone: string | null;
}

/** Users (owner: identity, §6.2). */
@Injectable()
export class UserService {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** A staff member starts INVITED and becomes ACTIVE when they accept the invite (§8.2). */
  async createInvitedUser(
    db: Database,
    input: { email: string; displayName: string },
  ): Promise<UserProfile> {
    const [row] = await db
      .insert(schema.users)
      .values({
        email: input.email.trim(),
        displayName: input.displayName.trim(),
        status: "INVITED",
      })
      .onConflictDoNothing({ target: schema.users.email })
      .returning();
    if (row === undefined) throw new AppError("CONFLICT", "A user with this email already exists.");
    return toProfile(row);
  }

  async findById(id: string): Promise<UserProfile | null> {
    const [row] = await this.db.read.select().from(schema.users).where(eq(schema.users.id, id));
    return row === undefined ? null : toProfile(row);
  }
}

function toProfile(row: schema.UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    timezone: row.timezone,
  };
}
