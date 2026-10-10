import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card, cardClass } from "./card";

describe("Card", () => {
  it("is a bordered raised surface", () => {
    const html = renderToStaticMarkup(<Card>body</Card>);
    expect(html).toContain("bg-surface-raised");
    expect(html).toContain("border-line");
    expect(html).toContain("p-4");
  });

  it("holds rows edge to edge, with dividers, in the list variant", () => {
    const html = renderToStaticMarkup(<Card list>rows</Card>);
    expect(html).toContain("divide-y");
    expect(html).toContain("overflow-hidden");
    expect(html).not.toContain("p-4");
  });

  it("gives a whole-card link its hover and focus treatment", () => {
    expect(cardClass({ interactive: true })).toContain("hover:bg-surface-sunken");
  });
});
