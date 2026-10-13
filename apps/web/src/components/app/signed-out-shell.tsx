import { useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Crest } from "../../design/crest";
import { InstitutionName } from "./shell-parts";

/** Pages that draw the crest and name themselves (AuthLayout), so they need no top bar. */
const AUTH_PAGES = ["/login", "/forgot", "/reset/", "/invite/", "/verify/"];

/**
 * Pages for people who aren't signed in: the crest and name over a centred column. The sign-in
 * pages show a larger crest of their own instead of the top bar.
 */
export function SignedOutShell({
  institutionName,
  children,
}: {
  institutionName: string | undefined;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  // The landing page (routes/landing.tsx) is full width and draws its own top bar and footer.
  if (pathname === "/") return <>{children}</>;
  const authPage = AUTH_PAGES.some((page) =>
    page.endsWith("/") ? pathname.startsWith(page) : pathname === page,
  );
  return (
    <div className="min-h-dvh bg-surface text-ink">
      {authPage ? null : (
        <header className="glim-safe-top flex h-14 items-center gap-2 border-b border-line bg-surface-raised px-4">
          <Crest size={28} />
          <InstitutionName name={institutionName} testId="institution-name" />
        </header>
      )}
      <main
        className={
          authPage ? "glim-gutter glim-safe-top py-8" : "glim-gutter mx-auto w-full max-w-3xl py-6"
        }
      >
        {children}
      </main>
    </div>
  );
}
