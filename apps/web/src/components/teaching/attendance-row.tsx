import type { ReactNode } from "react";
import { Avatar } from "../ui/avatar";
import { Badge, type BadgeStatus } from "../ui/badge";

/**
 * One student's attendance (§9.18): initials, name and a meta line ("Online · late"), the status
 * as a Badge, "Edited" when staff changed it, and the row's action (the change button, or roll
 * call's marks underneath on a phone).
 */
export function AttendanceRow({
  name,
  meta,
  status,
  edited = false,
  photoUrl,
  action,
  below,
}: {
  name: string;
  meta: ReactNode;
  status?: BadgeStatus | undefined;
  edited?: boolean;
  /** Roll call shows the passport photo so the Lecturer can match faces (TRD §18.4). */
  photoUrl?: string | null;
  action?: ReactNode;
  /** Controls under the name, full width (roll call's marks). */
  below?: ReactNode;
}) {
  return (
    <div role="listitem" aria-label={name} className="space-y-3 px-4 py-3">
      <div className="flex items-center gap-3">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            loading="lazy"
            className="h-12 w-9 shrink-0 rounded-sm object-cover"
          />
        ) : (
          <Avatar name={name} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-subhead" title={name}>
            {name}
          </p>
          <p className="text-meta text-ink-muted">{meta}</p>
        </div>
        {status ? <Badge status={status} /> : null}
        {edited ? <span className="text-caption text-ink-muted">Edited</span> : null}
        {action}
      </div>
      {below}
    </div>
  );
}
