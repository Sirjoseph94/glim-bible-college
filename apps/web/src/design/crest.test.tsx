import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Crest } from "./crest";

describe("Crest", () => {
  it("shows the crest at top-bar size on a white chip, named for screen readers", () => {
    const html = renderToStaticMarkup(<Crest />);
    expect(html).toContain('alt="GLIM crest"');
    expect(html).toContain('height="28"');
    expect(html).toContain("glim-chip");
    expect(html).toContain("p-0.5 rounded-sm");
    // No style attribute: `style-src 'self'` would drop it on the static pages.
    expect(html).not.toContain("style=");
  });

  it("scales the chip's padding and corners with the crest (§7.3)", () => {
    expect(renderToStaticMarkup(<Crest size={32} />)).toContain("p-0.5 rounded-sm");
    expect(renderToStaticMarkup(<Crest size={36} />)).toContain("p-[3px] rounded-[8px]");
    expect(renderToStaticMarkup(<Crest size={72} />)).toContain("p-1.5 rounded-[12px]");
  });
});
