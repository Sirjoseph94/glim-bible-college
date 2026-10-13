// UI-1 (docs/ui-design-handoff.md §0.2, §16.2): feature code uses design tokens, not raw values.
// Flags raw colours, px sizes and Tailwind arbitrary values in string literals. An approved
// exception is a disable comment whose description starts with "design-exception:", e.g.
//   // eslint-disable-next-line glim/design-tokens -- design-exception: Google's "G" mark
// Severity is "error" since WP-UI-12 (decision UI-Q16).

const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;
const RAW_PX = /\b\d+(?:\.\d+)?px\b/;
// An arbitrary value (`w-[149px]`), not an arbitrary variant (`data-[state=checked]:`), which
// selects on an attribute and carries no design value.
const ARBITRARY = /[\w-]-\[[^\]]*\](?!:)/;

/** @type {import("eslint").Rule.RuleModule} */
export const designTokens = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Use design tokens instead of raw colours, px sizes and arbitrary values",
    },
    schema: [],
    messages: {
      colour:
        "Raw colour: use a colour token (bg-surface, text-ink-muted, …) from styles/tokens.css.",
      px: "Raw px size: use a spacing, size or type token (p-4, h-control, text-body-sm, …).",
      arbitrary:
        "Tailwind arbitrary value: use a token class; geometry needs a design-exception comment.",
    },
  },
  create(context) {
    /** @param {import("estree").Node} node @param {string} text */
    function check(node, text) {
      if (RAW_COLOUR.test(text)) context.report({ node, messageId: "colour" });
      else if (RAW_PX.test(text)) context.report({ node, messageId: "px" });
      else if (ARBITRARY.test(text)) context.report({ node, messageId: "arbitrary" });
    }
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};
