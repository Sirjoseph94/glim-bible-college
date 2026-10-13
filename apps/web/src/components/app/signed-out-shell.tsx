import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Crest } from "../../design/crest";
import { InstitutionName } from "./shell-parts";

/** Full-width pages that lay themselves out with PublicTopBar (the landing page, D-UI-02). */
const OWN_LAYOUT = ["/"];

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
  if (OWN_LAYOUT.includes(pathname)) return <>{children}</>;
  const authPage = AUTH_PAGES.some((page) =>
    page.endsWith("/") ? pathname.startsWith(page) : pathname === page,
  );
  return (
    <div className="min-h-dvh bg-surface text-ink">
      {authPage ? null : <PublicTopBar institutionName={institutionName} />}
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

/** The signed-out top bar: the crest and the college's name, with an optional action on the right. */
export function PublicTopBar({
  institutionName,
  action,
}: {
  institutionName: string | undefined;
  action?: ReactNode;
}) {
  return (
    <header className="glim-safe-top border-b border-line bg-surface-raised">
      <div className="glim-gutter mx-auto flex h-14 w-full max-w-content items-center justify-between gap-3">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <Crest size={28} />
          <InstitutionName name={institutionName} testId="institution-name" />
        </Link>
        {action}
      </div>
    </header>
  );
}
