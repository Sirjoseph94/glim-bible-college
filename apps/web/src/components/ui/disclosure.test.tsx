import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Disclosure } from "./disclosure";

describe("Disclosure", () => {
  it("is a native details/summary, so it opens by keyboard with no script", () => {
    const html = renderToStaticMarkup(
      <Disclosure summary="2025/26 · First semester · GPA 4.20">rows</Disclosure>,
    );
    expect(html).toMatch(/^<details/);
    expect(html).toMatch(/<summary[^>]*>.*2025\/26 · First semester · GPA 4.20.*<\/summary>/);
    expect(html).toContain("rows");
    expect(html).not.toContain(" open");
  });

  it("can start open", () => {
    expect(
      renderToStaticMarkup(
        <Disclosure summary="x" defaultOpen>
          y
        </Disclosure>,
      ),
    ).toContain('open=""');
  });
});
