import { PERMISSIONS, STAFF_ROLES, type Permission, type StaffRole } from "@glim/contracts";
import raw from "./matrix.json" with { type: "json" };

export interface StudentRule {
  /** E = ENROLLED only; E/C = ENROLLED or COMPLETED. */
  status?: "E" | "E/C";
  own?: boolean;
  any?: boolean;
  rule?: string;
}

export interface PermissionGrants {
  staff: StaffRole[];
  /** A lecturer capability (§7.4), or "*" for any active Lecturer. */
  lecturer?: string;
  student?: StudentRule;
  applicant?: boolean;
}

export interface Matrix {
  permissions: Record<Permission, PermissionGrants>;
  lecturerCapabilities: Record<string, string[]>;
}

function validate(input: typeof raw): Matrix {
  const permissions = input.permissions as Record<string, PermissionGrants>;
  const names = Object.keys(permissions);
  const missing = PERMISSIONS.filter((p) => !names.includes(p));
  const extra = names.filter((n) => !(PERMISSIONS as readonly string[]).includes(n));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `matrix.json and contracts PERMISSIONS differ: missing ${missing.join(", ")}; extra ${extra.join(", ")}`,
    );
  }
  for (const [name, grants] of Object.entries(permissions)) {
    for (const role of grants.staff) {
      if (!(STAFF_ROLES as readonly string[]).includes(role))
        throw new Error(`${name}: unknown staff role ${role}`);
    }
    if (
      grants.lecturer !== undefined &&
      grants.lecturer !== "*" &&
      !(grants.lecturer in input.lecturerCapabilities)
    ) {
      throw new Error(`${name}: unknown lecturer capability ${grants.lecturer}`);
    }
  }
  return {
    permissions: permissions,
    lecturerCapabilities: input.lecturerCapabilities,
  };
}

/** The permission matrix (TRD §7.3, §7.4), validated against the contracts at load. */
export const MATRIX: Matrix = validate(raw);

const staffSets = new Map<Permission, ReadonlySet<StaffRole>>(
  PERMISSIONS.map((p) => [p, new Set(MATRIX.permissions[p].staff)]),
);

export function staffRolesGranting(permission: Permission): ReadonlySet<StaffRole> {
  return staffSets.get(permission) ?? new Set();
}
