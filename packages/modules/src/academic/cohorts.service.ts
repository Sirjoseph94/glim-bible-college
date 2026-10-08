import { schema, type Database } from "@glim/db";
import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

/** Cohorts: one programme's students starting in one intake (owner: academic, TRD §6.3). */
@Injectable()
export class CohortsService {
  /** The cohort for a programme and intake, created by the first acceptance, e.g. "DIP-2027". */
  async getOrCreate(
    db: Database,
    input: {
      programme: { id: string; code: string; name: string };
      intake: { id: string; code: string };
    },
  ): Promise<string> {
    const c = schema.cohorts;
    await db
      .insert(c)
      .values({
        programmeId: input.programme.id,
        intakeId: input.intake.id,
        code: `${input.programme.code}-${input.intake.code}`,
        name: `${input.programme.name}, ${input.intake.code} intake`,
      })
      .onConflictDoNothing();
    const [row] = await db
      .select({ id: c.id })
      .from(c)
      .where(and(eq(c.programmeId, input.programme.id), eq(c.intakeId, input.intake.id)));
    if (row === undefined) throw new Error("cohort missing after insert");
    return row.id;
  }
}
