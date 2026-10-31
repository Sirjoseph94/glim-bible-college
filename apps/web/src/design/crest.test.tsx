import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Crest } from "./crest";

describe("Crest", () => {
  it("shows the crest at top-bar size on a white chip, named for screen readers", () => {
    const html = renderToStaticMarkup(<Crest />);
    expect(html).toContain('alt="GLIM crest"');
    expect(html).toContain('height="28"');
    expect(html).toContain("glim-chip");
    expect(html).toContain("padding:2px");
    expect(html).toContain("border-radius:6px");
  });

  it("scales the chip's padding and corners with the crest (§7.3)", () => {
    expect(renderToStaticMarkup(<Crest size={32} />)).toMatch(/padding:2px;border-radius:6px/);
    expect(renderToStaticMarkup(<Crest size={36} />)).toMatch(/padding:3px;border-radius:8px/);
    expect(renderToStaticMarkup(<Crest size={72} />)).toMatch(/padding:6px;border-radius:12px/);
  });
});
