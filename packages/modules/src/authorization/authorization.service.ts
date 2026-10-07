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
}

/** The caller, with what's been looked up about them memoized for this request only (§7.2). */
export class Principal {
  private staffRoles: Promise<StaffRole[]> | undefined;
  private lecturer: Promise<boolean> | undefined;
  private readonly assignments = new Map<string, Promise<OfferingAssignment | null>>();

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
 * The single authorization decision point (§7.2, INV-1). Deny by default. Staff and lecturer
 * paths are complete; the student and applicant paths arrive with enrollments (ticket 19) and
 * applications (ticket 12).
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
      context = loaded;
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

    // Student path (step 4): lands with course enrollments (ticket 19).
    // Applicant path (step 5): lands with applications (ticket 12).
    return resource === undefined ? "DENY" : "NOT_FOUND";
  }

  /** Whether a set of staff roles grants a permission on the staff path alone. */
  static staffGrants(roles: readonly StaffRole[], permission: Permission): boolean {
    const granting = staffRolesGranting(permission);
    return roles.some((role) => granting.has(role));
  }

  /** Roles derived from data rather than assignments (§7.1), for navigation (`GET /me`). */
  async derivedRoles(userId: string): Promise<{ isLecturer: boolean }> {
    return { isLecturer: await this.isActiveLecturer(userId) };
  }

  private async isActiveLecturer(userId: string): Promise<boolean> {
    const l = schema.lecturers;
    const [row] = await this.db.read
      .select({ id: l.id })
      .from(l)
      .where(and(eq(l.userId, userId), eq(l.status, "ACTIVE")));
    return row !== undefined;
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
