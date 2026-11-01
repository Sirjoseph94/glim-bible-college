import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicTopBar } from "./components/app/signed-out-shell";
import { ContactPage, LEGAL_NAME, PrivacyPage, TermsPage } from "./routes/legal";

/**
 * Pages built to static HTML (scripts/prerender.mjs): plain documents with no JavaScript, so the
 * text is all there for Google's OAuth review and for a phone on a weak signal. The API serves
 * these files to every request (apps/api/src/static.ts), and links to them reload the document.
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
  {
    path: "/contact",
    file: "contact.html",
    title: `Contact us · ${LEGAL_NAME}`,
    description: `How to contact ${LEGAL_NAME}.`,
    page: () => <ContactPage />,
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

const ROOT_DIV = '<div id="root"></div>';

const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/**
 * The dark tokens from tokens.css for a page with no script to set `data-theme`: they follow the
 * device's colour scheme instead (UI-2). A file of its own, since `style-src 'self'` blocks inline CSS.
 */
export function deviceThemeCss(tokensCss: string): string {
  const dark = /\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(tokensCss)?.[1];
  if (dark === undefined) throw new Error("prerender: no dark theme block in tokens.css");
  return `@media (prefers-color-scheme: dark) {\n  :root {${dark}}\n}\n`;
}

/**
 * The built index.html turned into the page's own document: its markup in #root, its title and
 * description, every script and module preload removed, and `themeHref` (deviceThemeCss) linked
 * after the app's stylesheet.
 */
export function staticDocument(
  template: string,
  themeHref: string,
  entry: (typeof PRERENDERED)[number],
): string {
  if (!template.includes(ROOT_DIV)) throw new Error(`prerender: ${ROOT_DIV} not found`);
  const head = [
    `<title>${escape(entry.title)}</title>`,
    `<meta name="description" content="${escape(entry.description)}" />`,
  ].join("\n    ");
  const page = renderPage(entry);
  return template
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/g, "")
    .replace(/<link rel="modulepreload"[^>]*>\s*/g, "")
    .replace(' data-theme="light"', "")
    .replace(/<title>[^<]*<\/title>/, () => head)
    .replace("</head>", () => `  <link rel="stylesheet" href="${escape(themeHref)}" />\n  </head>`)
    .replace(ROOT_DIV, () => `<div id="root">${page}</div>`);
}
