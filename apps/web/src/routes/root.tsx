import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { institutionQuery } from "../api/institution";
import { meQuery, signOut } from "../api/session";

export function RootLayout() {
  const institution = useQuery(institutionQuery);
  const me = useQuery(meQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-slate-50 font-sans text-slate-900">
      <header className="flex items-center justify-between gap-4 bg-brand px-4 py-3 text-white">
        {institution.data ? (
          <h1 className="text-lg font-semibold" data-testid="institution-name">
            {institution.data.name}
          </h1>
        ) : (
          <div className="h-7 w-56 animate-pulse rounded bg-white/20" aria-label="Loading" />
        )}
        {me.data ? (
          <button
            type="button"
            className="rounded border border-white/40 px-3 py-1 text-sm"
            onClick={() => {
              void signOut(queryClient).then(() => navigate({ to: "/login" }));
            }}
          >
            Sign out
          </button>
        ) : null}
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
