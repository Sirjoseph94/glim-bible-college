/** What an assignment says about late work (TRD §14.2). */
export interface LateRules {
  dueAt: Date;
  cutoffAt: Date | null;
  allowLate: boolean;
  penaltyPercentPerDay?: number | undefined;
}

const DAY_MS = 86_400_000;

/** When submissions stop: the cutoff, else the due date unless late work is allowed (then never). */
export function closesAt(rules: LateRules): Date | null {
  if (rules.cutoffAt !== null) return rules.cutoffAt;
  return rules.allowLate ? null : rules.dueAt;
}

/** Whether a draft may be saved or submitted at `now` (the close instant itself still counts). */
export function isOpen(rules: LateRules, now: Date): boolean {
  const closes = closesAt(rules);
  return closes === null || now.getTime() <= closes.getTime();
}

export function isLate(rules: LateRules, submittedAt: Date): boolean {
  return submittedAt.getTime() > rules.dueAt.getTime();
}

/** Started days late: one second late is one day. */
export function daysLate(rules: LateRules, submittedAt: Date): number {
  const late = submittedAt.getTime() - rules.dueAt.getTime();
  return late <= 0 ? 0 : Math.ceil(late / DAY_MS);
}

/** The deduction the late policy suggests to the grader, in whole percent (capped at 100). */
export function suggestedPenaltyPercent(rules: LateRules, submittedAt: Date): number {
  return Math.min(100, daysLate(rules, submittedAt) * (rules.penaltyPercentPerDay ?? 0));
}
