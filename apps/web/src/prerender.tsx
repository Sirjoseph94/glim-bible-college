import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicTopBar } from "./components/app/signed-out-shell";
import { LEGAL_NAME, PrivacyPage, TermsPage } from "./routes/legal";

/**
 * Pages built to static HTML (scripts/prerender.mjs), so their text is in the document itself:
 * Google's OAuth review reads the privacy policy without running JavaScript. The API serves these
 * files to every request (apps/api/src/static.ts); in a browser the app then starts over them.
 */
export const PRERENDERED: {
  path: string;
  file: string;
  title: string;
  description: string;
  page: () => ReactElement;
}[] = [
  {
    path: "/privacy",
    file: "privacy.html",
    title: `Privacy policy · ${LEGAL_NAME}`,
    description: `How ${LEGAL_NAME} collects, uses, shares and protects personal data, including data from Google sign-in.`,
    page: () => <PrivacyPage />,
  },
  {
    path: "/terms",
    file: "terms.html",
    title: `Terms of Service · ${LEGAL_NAME}`,
    description: `The terms for using the ${LEGAL_NAME} website and its services.`,
    page: () => <TermsPage />,
  },
];

/** The markup for #root: the signed-out layout (SignedOutShell) around the page. */
export function renderPage(entry: (typeof PRERENDERED)[number]): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [entry.path] }),
  });
  return renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <div className="min-h-dvh bg-surface text-ink">
        <PublicTopBar institutionName={LEGAL_NAME} />
        <main className="glim-gutter mx-auto w-full max-w-3xl py-6">{entry.page()}</main>
      </div>
    </RouterContextProvider>,
  );
}
