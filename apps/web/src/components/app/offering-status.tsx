import type { Offering } from "@glim/contracts";
import { Badge, type Tone } from "../ui/badge";

const OFFERING_STATUS: Record<Offering["status"], { tone: Tone; word: string }> = {
  DRAFT: { tone: "neutral", word: "Draft" },
  PUBLISHED: { tone: "info", word: "Published" },
  ACTIVE: { tone: "success", word: "Active" },
  COMPLETED: { tone: "neutral", word: "Completed" },
  CANCELLED: { tone: "danger", word: "Cancelled" },
};

/** A Course Offering's status as a word (UI-3), for Lecturers' and admins' lists. */
export function OfferingStatusBadge({ status }: { status: Offering["status"] }) {
  const { tone, word } = OFFERING_STATUS[status];
  return <Badge tone={tone}>{word}</Badge>;
}
