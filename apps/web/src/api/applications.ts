import type { applications, ApplicationStatus } from "@glim/contracts";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";

export const mineQuery = queryOptions({
  queryKey: ["applications", "mine"],
  queryFn: ({ signal }) =>
    api<typeof applications.myApplications>("GET", "/applications/mine", { signal }),
});

export const applicationQuery = (id: string) =>
  queryOptions({
    queryKey: ["applications", id],
    queryFn: ({ signal }) =>
      api<typeof applications.getApplication>("GET", "/applications/:id", {
        params: { id },
        signal,
      }),
  });

/** How each status reads to the applicant. */
export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  DRAFT: "Started",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  ADMITTED: "Admitted: offer made",
  ACCEPTED: "Offer accepted",
  REJECTED: "Not admitted",
  LAPSED: "Offer lapsed",
  WITHDRAWN: "Withdrawn",
};

/** Statuses after which the applicant may start a new application. */
export const ENDED: readonly ApplicationStatus[] = ["REJECTED", "LAPSED", "WITHDRAWN"];
/** Statuses from which the applicant may withdraw (§10.3). */
export const WITHDRAWABLE: readonly ApplicationStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "ADMITTED",
];
