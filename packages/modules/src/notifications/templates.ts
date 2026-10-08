import type { MailMessage } from "@glim/integrations/mail/port";
import { formatDualTime } from "@glim/shared/time";

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

  "admissions.application.admitted": ({ data, appOrigin }) => {
    const zone = str(data.timeZone) || "Africa/Lagos";
    const deadline = formatDualTime(str(data.offerExpiresAt), {
      viewerZone: zone,
      institutionZone: zone,
      withDate: true,
    });
    return email({
      subject: "Your offer of a place at GLIM Online Bible College",
      category: "application-admitted",
      paragraphs: [
        `Dear ${str(data.name)},`,
        `We're delighted to offer you a place on the ${str(data.programmeName)} (${str(data.studyMode)}), starting in the ${str(data.academicSessionName)}. Your Application Reference No is ${str(data.referenceNo)}.`,
        `Please accept your offer by ${deadline}. If you don't accept by then, the offer lapses.`,
        "When you accept, you'll get your Matric Number and the first steps for your studies.",
      ],
      link: { label: "Accept your offer", url: `${appOrigin}/application` },
    });
  },

  "admissions.offer.reminder": ({ data, appOrigin }) => {
    const zone = str(data.timeZone) || "Africa/Lagos";
    const deadline = formatDualTime(str(data.offerExpiresAt), {
      viewerZone: zone,
      institutionZone: zone,
      withDate: true,
    });
    const days = typeof data.daysLeft === "number" ? data.daysLeft : 0;
    return email({
      subject: `Reminder: your offer from GLIM Online Bible College expires in ${String(days)} day${days === 1 ? "" : "s"}`,
      category: "offer-reminder",
      paragraphs: [
        `Dear ${str(data.name)},`,
        `This is a reminder that your offer of a place on the ${str(data.programmeName)} expires on ${deadline}.`,
        "If you'd like to study with us, please accept it before then. If you have a question, reply to this email.",
      ],
      link: { label: "Accept your offer", url: `${appOrigin}/application` },
    });
  },

  "admissions.application.lapsed": ({ data, appOrigin }) =>
    email({
      subject: "Your offer from GLIM Online Bible College has lapsed",
      category: "offer-lapsed",
      paragraphs: [
        `Dear ${str(data.name)},`,
        `Your offer of a place on the ${str(data.programmeName)} (Application Reference No ${str(data.referenceNo)}) wasn't accepted in time, so it has lapsed.`,
        "If you'd still like to study with us, please contact Admissions. They can reopen your offer.",
      ],
      link: { label: "View your application", url: `${appOrigin}/application` },
    }),

  "admissions.application.accepted": ({ data, appOrigin }) =>
    email({
      subject: `Welcome to GLIM Online Bible College: your Matric Number is ${str(data.matricNumber)}`,
      category: "application-accepted",
      paragraphs: [
        `Dear ${str(data.name)},`,
        `Welcome to GLIM Online Bible College! You've accepted your place on the ${str(data.programmeName)}, starting in the ${str(data.academicSessionName)}.`,
        `Your Matric Number is ${str(data.matricNumber)}. Please quote it whenever you contact the college.`,
        "Next steps: sign in with the same Google account you applied with. Your courses appear when registration opens for your first semester, and we'll email you before classes begin.",
        `Your personal referral code is ${str(data.referralCode)}. Share it with anyone you encourage to apply.`,
      ],
      link: { label: "Sign in to GLIM", url: `${appOrigin}/` },
    }),

  // Neutral wording; the officer's internal note is never part of it (spec story 33).
  "admissions.application.rejected": ({ data, appOrigin }) =>
    email({
      subject: "Your application to GLIM Online Bible College",
      category: "application-rejected",
      paragraphs: [
        `Dear ${str(data.name)},`,
        `Thank you for applying to GLIM Online Bible College (Application Reference No ${str(data.referenceNo)}).`,
        "We have carefully considered your application, and we're sorry that we're unable to offer you a place this time.",
        "We're grateful for your interest in studying with us, and we wish you every blessing.",
      ],
      link: { label: "View your application", url: `${appOrigin}/application` },
    }),
};
