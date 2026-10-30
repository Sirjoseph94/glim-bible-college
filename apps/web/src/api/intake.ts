import type { admissions } from "@glim/contracts";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";

/** The open Intake (else the next or the last one), its Programmes and the Statement of Faith. */
export const currentIntakeQuery = queryOptions({
  queryKey: ["intake", "current"],
  queryFn: ({ signal }) =>
    api<typeof admissions.getCurrentIntake>("GET", "/public/intakes/current", { signal }),
  staleTime: 10 * 60 * 1000,
});

/**
 * How the Programme runs, as the public pages say it (ADR-0005): one course at a time, the
 * Certificate halfway and the Diploma at the end.
 */
export const PROGRAMME_SHAPE =
  "One course at a time · the Certificate halfway, the Diploma when you finish";
