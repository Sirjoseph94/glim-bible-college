import type { Permission, ResourceType, StaffRole } from "@glim/contracts";
import { Db, schema } from "@glim/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { MATRIX, staffRolesGranting } from "./matrix";
import { RoleService } from "./role.service";

/** What the owning module knows about a resource (§7.2 step 1). */
export interface ResourceContext {
  offeringId?: string;
  ownerUserId?: string;
  applicationId?: string;
}

/** Loads a resource's context; null when the resource doesn't exist. */
export type ResourceContextLoader = (id: string) => Promise<ResourceContext | null>;

export interface ResourceRef {
  type: ResourceType;
  id: string;
  /**
   * The caller's own part of the resource (e.g. their playback progress on a video): the write can
   * only reach the caller's row, so "own" rules hold by construction.
   */
  ownPart?: boolean;
}

/** A lecturer's active assignment on one offering, as `v_offering_access` reports it. */
export interface OfferingAssignment {
  role: string;
  capabilityOverrides: Record<string, boolean>;
}

interface PrincipalLookups {
  staffRoles: () => Promise<StaffRole[]>;
  isLecturer: () => Promise<boolean>;
  assignmentOn: (offeringId: string) => Promise<OfferingAssignment | null>;
  isStudent: () => Promise<boolean>;
  /** A student who has GRADUATED: their own records stay theirs (transcripts, results). */
  isAlumnus: () => Promise<boolean>;
  /** The student's course enrollment status on an offering (ENROLLED or COMPLETED), if any. */
  studentAccessOn: (offeringId: string) => Promise<string | null>;
}

/** The caller, with what's been looked up about them memoized for this request only (§7.2). */
export class Principal {
  private staffRoles: Promise<StaffRole[]> | undefined;
  private lecturer: Promise<boolean> | undefined;
  private readonly assignments = new Map<string, Promise<OfferingAssignment | null>>();
  private student: Promise<boolean> | undefined;
  private alumnus: Promise<boolean> | undefined;
  private readonly studentAccess = new Map<string, Promise<string | null>>();

  constructor(
    readonly userId: string,
    private readonly lookups: PrincipalLookups,
  ) {}

  roles(): Promise<StaffRole[]> {
    this.staffRoles ??= this.lookups.staffRoles();
    return this.staffRoles;
  }

  isLecturer(): Promise<boolean> {
    this.lecturer ??= this.lookups.isLecturer();
    return this.lecturer;
  }

  isStudent(): Promise<boolean> {
    this.student ??= this.lookups.isStudent();
    return this.student;
  }

  isAlumnus(): Promise<boolean> {
    this.alumnus ??= this.lookups.isAlumnus();
    return this.alumnus;
  }

  studentAccessOn(offeringId: string): Promise<string | null> {
    let found = this.studentAccess.get(offeringId);
    if (found === undefined) {
      found = this.lookups.studentAccessOn(offeringId);
      this.studentAccess.set(offeringId, found);
    }
    return found;
  }

  assignmentOn(offeringId: string): Promise<OfferingAssignment | null> {
    let found = this.assignments.get(offeringId);
    if (found === undefined) {
      found = this.lookups.assignmentOn(offeringId);
      this.assignments.set(offeringId, found);
    }
    return found;
  }
}

export type Decision = "ALLOW" | "DENY" | "NOT_FOUND";

/** Whether an assignment carries a §7.4 capability: an explicit override wins over the role default. */
export function assignmentHasCapability(
  assignment: OfferingAssignment,
  capability: string,
): boolean {
  const override = assignment.capabilityOverrides[capability];
  if (override !== undefined) return override;
  return (MATRIX.lecturerCapabilities[capability] ?? []).includes(assignment.role);
}

/**
 * The single authorization decision point (§7.2, INV-1). Deny by default: staff role, then
 * lecturer assignment capability, then student entitlement, then applicant ownership.
 */
@Injectable()
export class AuthorizationService {
  private readonly loaders = new Map<ResourceType, ResourceContextLoader>();

  constructor(
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(Db) private readonly db: Db,
  ) {}

  /** Called by the module that owns a resource type, once, at startup. */
  registerLoader(type: ResourceType, loader: ResourceContextLoader): void {
    if (this.loaders.has(type)) {
      throw new Error(`A ResourceContextLoader for "${type}" is already registered`);
    }
    this.loaders.set(type, loader);
  }

  principal(userId: string): Principal {
    return new Principal(userId, {
      staffRoles: () => this.roles.activeRoles(userId),
      isLecturer: () => this.isActiveLecturer(userId),
      assignmentOn: (offeringId) => this.assignmentOn(userId, offeringId),
      isStudent: () => this.isActiveStudent(userId),
      isAlumnus: () => this.isGraduate(userId),
      studentAccessOn: (offeringId) => this.studentAccessOn(userId, offeringId),
    });
  }

  async authorize(
    principal: Principal,
    permission: Permission,
    resource?: ResourceRef,
  ): Promise<Decision> {
    let context: ResourceContext | undefined;
    if (resource !== undefined) {
      const loader = this.loaders.get(resource.type);
      if (loader === undefined) {
        throw new Error(`No ResourceContextLoader registered for "${resource.type}"`);
      }
      const loaded = await loader(resource.id);
      if (loaded === null) return "NOT_FOUND";
      context = resource.ownPart === true ? { ...loaded, ownerUserId: principal.userId } : loaded;
    }

    // Staff path (§7.2 step 2).
    const granting = staffRolesGranting(permission);
    if ((await principal.roles()).some((role) => granting.has(role))) return "ALLOW";

    // Lecturer path (step 3): any active Lecturer ("*"), or a capability on the resource's offering.
    const capability = MATRIX.permissions[permission].lecturer;
    if (capability === "*" && (await principal.isLecturer())) return "ALLOW";
    if (capability !== undefined && capability !== "*" && context?.offeringId !== undefined) {
      const assignment = await principal.assignmentOn(context.offeringId);
      if (assignment !== null && assignmentHasCapability(assignment, capability)) return "ALLOW";
    }

    // Student path (step 4): any active student, or entitlement on the resource's offering
    // through v_offering_access (E = ENROLLED; E/C = ENROLLED or COMPLETED), plus ownership.
    const rule = MATRIX.permissions[permission].student;
    // A graduate keeps rules that are only about their own records (no enrollment status).
    const ownOnly = rule?.own === true && rule.status === undefined && rule.any !== true;
    if (
      rule !== undefined &&
      ((await principal.isStudent()) || (ownOnly && (await principal.isAlumnus())))
    ) {
      if (rule.any === true) return "ALLOW";
      const owns = rule.own !== true || context?.ownerUserId === principal.userId;
      if (rule.status !== undefined) {
        if (context?.offeringId !== undefined && owns) {
          const access = await principal.studentAccessOn(context.offeringId);
          const allowed = rule.status === "E" ? ["ENROLLED"] : ["ENROLLED", "COMPLETED"];
          if (access !== null && allowed.includes(access)) return "ALLOW";
        }
      } else if (rule.own === true && context?.ownerUserId !== undefined && owns) {
        return "ALLOW";
      }
    }

    // Applicant path (step 5): their own application only.
    if (
      MATRIX.permissions[permission].applicant === true &&
      context?.applicationId !== undefined &&
      context.ownerUserId === principal.userId
    )
      return "ALLOW";

    return resource === undefined ? "DENY" : "NOT_FOUND";
  }

  /** Whether a set of staff roles grants a permission on the staff path alone. */
  static staffGrants(roles: readonly StaffRole[], permission: Permission): boolean {
    const granting = staffRolesGranting(permission);
    return roles.some((role) => granting.has(role));
  }

  /** Roles derived from data rather than assignments (§7.1), for navigation (`GET /me`). */
  async derivedRoles(userId: string): Promise<{
    isLecturer: boolean;
    isStudent: boolean;
    isAlumnus: boolean;
    isApplicant: boolean;
  }> {
    const [isLecturer, isStudent, isAlumnus, isApplicant] = await Promise.all([
      this.isActiveLecturer(userId),
      this.isActiveStudent(userId),
      this.isGraduate(userId),
      this.ownsAnApplication(userId),
    ]);
    return { isLecturer, isStudent, isAlumnus, isApplicant };
  }

  private async isActiveStudent(userId: string): Promise<boolean> {
    const s = schema.students;
    const [row] = await this.db.read
      .select({ id: s.id })
      .from(s)
      .where(and(eq(s.userId, userId), eq(s.status, "ACTIVE")));
    return row !== undefined;
  }

  private async isGraduate(userId: string): Promise<boolean> {
    const s = schema.students;
    const [row] = await this.db.read
      .select({ id: s.id })
      .from(s)
      .where(and(eq(s.userId, userId), eq(s.status, "GRADUATED")));
    return row !== undefined;
  }

  private async ownsAnApplication(userId: string): Promise<boolean> {
    const a = schema.applications;
    const [row] = await this.db.read
      .select({ id: a.id })
      .from(a)
      .where(eq(a.applicantUserId, userId))
      .limit(1);
    return row !== undefined;
  }

  private async isActiveLecturer(userId: string): Promise<boolean> {
    const l = schema.lecturers;
    const [row] = await this.db.read
      .select({ id: l.id })
      .from(l)
      .where(and(eq(l.userId, userId), eq(l.status, "ACTIVE")));
    return row !== undefined;
  }

  private async studentAccessOn(userId: string, offeringId: string): Promise<string | null> {
    const { rows } = await this.db.read.execute<{ source_status: string }>(
      sql`SELECT source_status FROM v_offering_access
          WHERE user_id = ${userId} AND course_offering_id = ${offeringId} AND access_kind = 'STUDENT'
          ORDER BY source_status = 'ENROLLED' DESC
          LIMIT 1`,
    );
    return rows[0]?.source_status ?? null;
  }

  private async assignmentOn(
    userId: string,
    offeringId: string,
  ): Promise<OfferingAssignment | null> {
    const { rows } = await this.db.read.execute<{
      source_status: string;
      capability_overrides: Record<string, boolean>;
    }>(
      sql`SELECT source_status, capability_overrides FROM v_offering_access
          WHERE user_id = ${userId} AND course_offering_id = ${offeringId} AND access_kind = 'STAFF'
          LIMIT 1`,
    );
    const [row] = rows;
    return row === undefined
      ? null
      : { role: row.source_status, capabilityOverrides: row.capability_overrides };
  }
}
