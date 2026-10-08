import type { MailMessage } from "@glim/integrations/mail/port";

/** What a template needs; `appOrigin` builds deep links into the SPA. */
export interface TemplateInput {
  data: Record<string, unknown>;
  appOrigin: string;
}

type Rendered = Pick<MailMessage, "subject" | "text" | "html" | "category">;

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const str = (value: unknown) => (typeof value === "string" ? value : "");

/** Plain text plus minimal HTML (TRD §15.1): no remote images, well under 20 KB. */
function email(input: {
  subject: string;
  category: string;
  paragraphs: string[];
  link?: { label: string; url: string };
}): Rendered {
  const text = [
    ...input.paragraphs.flatMap((p) => [p, ""]),
    ...(input.link ? [`${input.link.label}: ${input.link.url}`, ""] : []),
    "GLIM Online Bible College",
  ].join("\n");
  const html = [
    '<div style="font-family:sans-serif;font-size:15px;line-height:1.5;color:#1e293b">',
    ...input.paragraphs.map((p) => `<p>${escape(p)}</p>`),
    ...(input.link
      ? [`<p><a href="${escape(input.link.url)}">${escape(input.link.label)}</a></p>`]
      : []),
    "<p>GLIM Online Bible College</p>",
    "</div>",
  ].join("");
  return { subject: input.subject, category: input.category, text, html };
}

/** Email templates by notification kind. Kinds without one are in-app only. */
export const TEMPLATES: Record<string, (input: TemplateInput) => Rendered> = {
  "admissions.application.receipt": ({ data, appOrigin }) =>
    email({
      subject: `We've received your application ${str(data.referenceNo)}`,
      category: "application-receipt",
      paragraphs: [
        `Dear ${str(data.name)},`,
        `Thank you for applying to GLIM Online Bible College. We have received your application for the ${str(data.programmeName)} (${str(data.studyMode)}), starting in the ${str(data.academicSessionName)}.`,
        `Your Application Reference No is ${str(data.referenceNo)}. Please quote it whenever you contact us.`,
        "We review applications as they arrive and will email you when there's a decision.",
      ],
      link: { label: "Check your application", url: `${appOrigin}/application` },
    }),
};
