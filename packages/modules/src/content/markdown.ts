import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

const marked = new Marked({ gfm: true, breaks: true });

/**
 * What rendered Markdown may contain (TRD §14.1, §19): text formatting, headings, lists, quotes,
 * code, tables and links. No images (no remote loads on low-bandwidth phones), no scripts,
 * styles, frames, forms or event handlers.
 */
const ALLOW: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "hr",
    "h2",
    "h3",
    "h4",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "a",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  allowedAttributes: { a: ["href"], ol: ["start"], th: ["align"], td: ["align"] },
  allowedSchemes: ["https", "http", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // Headings move down a level, so a material's text never outranks the page's own headings.
  transformTags: {
    h1: "h2",
    h2: "h3",
    h3: "h4",
    h4: "h4",
    h5: "h4",
    h6: "h4",
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: "noopener noreferrer nofollow", target: "_blank" },
    }),
  },
};
// The attributes the link transform adds must survive the allow-list.
ALLOW.allowedAttributes = { ...ALLOW.allowedAttributes, a: ["href", "rel", "target"] };

/** Markdown → HTML that is safe to put in the page as it is. */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false });
  return sanitizeHtml(html, ALLOW).trim();
}
