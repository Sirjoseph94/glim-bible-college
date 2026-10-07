import type { Permission, ResourceType, StaffRole } from "@glim/contracts";
import { Inject, Injectable } from "@nestjs/common";
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

/** The caller, with what's been looked up about them memoized for this request only (§7.2). */
export class Principal {
  private staffRoles: Promise<StaffRole[]> | undefined;

  constructor(
    readonly userId: string,
    private readonly loadStaffRoles: () => Promise<StaffRole[]>,
  ) {}

  roles(): Promise<StaffRole[]> {
    this.staffRoles ??= this.loadStaffRoles();
    return this.staffRoles;
  }
}

export type Decision = "ALLOW" | "DENY" | "NOT_FOUND";

/**
 * The single authorization decision point (§7.2, INV-1). Deny by default. The staff path is
 * complete; the lecturer, student and applicant paths are added by the tickets that create
 * lecturer assignments, enrollments and applications.
 */
@Injectable()
export class AuthorizationService {
  private readonly loaders = new Map<ResourceType, ResourceContextLoader>();

  constructor(@Inject(RoleService) private readonly roles: RoleService) {}

  /** Called by the module that owns a resource type, once, at startup. */
  registerLoader(type: ResourceType, loader: ResourceContextLoader): void {
    if (this.loaders.has(type))
      throw new Error(`A ResourceContextLoader for "${type}" is already registered`);
    this.loaders.set(type, loader);
  }

  principal(userId: string): Principal {
    return new Principal(userId, () => this.roles.activeRoles(userId));
  }

  async authorize(
    principal: Principal,
    permission: Permission,
    resource?: ResourceRef,
  ): Promise<Decision> {
    if (resource !== undefined) {
      const loader = this.loaders.get(resource.type);
      if (loader === undefined)
        throw new Error(`No ResourceContextLoader registered for "${resource.type}"`);
      if ((await loader(resource.id)) === null) return "NOT_FOUND";
    }

    const granting = staffRolesGranting(permission);
    if ((await principal.roles()).some((role) => granting.has(role))) return "ALLOW";

    // Lecturer path (§7.2 step 3): lands with lecturer assignments (ticket 10).
    // Student path (step 4): lands with course enrollments (ticket 19).
    // Applicant path (step 5): lands with applications (ticket 12).
    return resource === undefined ? "DENY" : "NOT_FOUND";
  }

  /** Whether a set of staff roles grants a permission on the staff path alone. */
  static staffGrants(roles: readonly StaffRole[], permission: Permission): boolean {
    const granting = staffRolesGranting(permission);
    return roles.some((role) => granting.has(role));
  }

  static readonly matrix = MATRIX;
}
