import type { auth, me, Me } from "@glim/contracts";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api, ApiError, setCsrfToken } from "./client";

/** The signed-in user, or null when there's no session. */
export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async ({ signal }): Promise<Me | null> => {
    try {
      const result = await api<typeof me.getMe>("GET", "/me", { signal });
      setCsrfToken(result.csrfToken);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setCsrfToken(null);
        return null;
      }
      throw error;
    }
  },
  staleTime: 5 * 60 * 1000,
});

export function signedIn(queryClient: QueryClient, result: Me): void {
  setCsrfToken(result.csrfToken);
  queryClient.setQueryData(meQuery.queryKey, result);
}

export async function signOut(queryClient: QueryClient): Promise<void> {
  await api<typeof auth.logout>("POST", "/auth/logout");
  setCsrfToken(null);
  queryClient.setQueryData(meQuery.queryKey, null);
}
