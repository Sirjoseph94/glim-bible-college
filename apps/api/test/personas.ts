import type { StaffRole } from "@glim/contracts";
import { schema } from "@glim/db";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { RoleService } from "@glim/modules/authorization";
import { SessionService } from "@glim/modules/identity";
import type { TestApp } from "./harness";

/**
 * Test personas (TRD §7.5). Staff personas exist from ticket 04; lecturers, students and
 * applicants join as their tickets land. `noRole` is an active user with no role at all.
 */
export const PERSONA_ROLES = {
  sysAdmin: ["SYSTEM_ADMIN"],
  admOfficer: ["ADMISSIONS_OFFICER"],
  registrar: ["REGISTRAR"],
  acadAdmin: ["ACADEMIC_ADMIN"],
  noRole: [],
} as const satisfies Record<string, readonly StaffRole[]>;

export type PersonaName = keyof typeof PERSONA_ROLES;

export interface Persona {
  name: PersonaName;
  userId: string;
  email: string;
  roles: readonly StaffRole[];
  /** Headers that make a request as this persona (session cookie + CSRF token). */
  headers: Record<string, string>;
}

/** Signs a user in directly, without going through the password flow. */
export async function sessionFor(t: TestApp, userId: string): Promise<Record<string, string>> {
  const sessions = t.app.get(SessionService);
  const { token, session } = await t.db.withTx(({ db }) => sessions.create(db, userId));
  return { cookie: `__Host-glim_sid=${token}`, "x-csrf-token": session.csrfToken };
}

export async function createUser(
  t: TestApp,
  input: { email: string; displayName?: string; roles?: readonly StaffRole[] },
) {
  const roles = t.app.get(RoleService);
  return t.db.withTx(async ({ db }) => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: input.email,
        displayName: input.displayName ?? input.email.split("@")[0] ?? "User",
        status: "ACTIVE",
      })
      .returning();
    if (user === undefined) throw new Error("user insert failed");
    for (const role of input.roles ?? []) {
      await roles.grant(db, SYSTEM_ACTOR, { userId: user.id, role, reason: "test persona" });
    }
    return user;
  });
}

export async function createPersonas(t: TestApp): Promise<Record<PersonaName, Persona>> {
  const out: Partial<Record<PersonaName, Persona>> = {};
  for (const [name, roles] of Object.entries(PERSONA_ROLES) as [
    PersonaName,
    readonly StaffRole[],
  ][]) {
    const email = `${name.toLowerCase()}@personas.glim.test`;
    const user = await createUser(t, { email, roles });
    out[name] = { name, userId: user.id, email, roles, headers: await sessionFor(t, user.id) };
  }
  return out as Record<PersonaName, Persona>;
}
