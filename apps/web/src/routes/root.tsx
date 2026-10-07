import { useQuery } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { institutionQuery } from "../api/institution";

export function RootLayout() {
  const institution = useQuery(institutionQuery);
  return (
    <div className="min-h-dvh bg-slate-50 font-sans text-slate-900">
      <header className="bg-brand px-4 py-3 text-white">
        {institution.data ? (
          <h1 className="text-lg font-semibold" data-testid="institution-name">
            {institution.data.name}
          </h1>
        ) : (
          <div className="h-7 w-56 animate-pulse rounded bg-white/20" aria-label="Loading" />
        )}
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
