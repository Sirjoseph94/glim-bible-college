import type { admissions, CurrentIntake } from "@glim/contracts";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";

/** The open Intake (else the next or the last one), its Programmes and the Statement of Faith. */
export const currentIntakeQuery = queryOptions({
  queryKey: ["intake", "current"],
  queryFn: ({ signal }) =>
    api<typeof admissions.getCurrentIntake>("GET", "/public/intakes/current", { signal }),
  staleTime: 10 * 60 * 1000,
});

const LENGTH: Record<string, string> = {
  CERTIFICATE: "1 year · Year 1",
  DIPLOMA: "2 years · Years 1 and 2",
};

/** How long a Programme takes, as the public pages say it. */
export function programmeLength(programme: CurrentIntake["programmes"][number]): string {
  return (
    LENGTH[programme.awardType] ??
    `${String(programme.levels)} ${programme.levels === 1 ? "year" : "years"}`
  );
}
