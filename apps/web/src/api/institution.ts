import type { platform } from "@glim/contracts";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";

export const institutionQuery = queryOptions({
  queryKey: ["institution"],
  queryFn: ({ signal }) =>
    api<typeof platform.getInstitution>("GET", "/public/institution", { signal }),
  staleTime: 60 * 60 * 1000,
});
