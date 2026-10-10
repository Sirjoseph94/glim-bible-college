import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Avatar, initials } from "./avatar";

describe("initials", () => {
  it("takes the first letters of the first and last names", () => {
    expect(initials("Tunde Bakare")).toBe("TB");
    expect(initials("Rev Dr Emeka Okafor")).toBe("RO");
    expect(initials("Adaeze")).toBe("A");
    expect(initials("  ")).toBe("");
  });

  it("keeps Yoruba and Igbo letters whole, with their marks (§5)", () => {
    expect(initials("Ụ̀kà Ọlọ́rùn")).toBe("Ụ̀Ọ");
    expect(initials("ẹ̀mí ọlá")).toBe("Ẹ̀Ọ");
  });
});

describe("Avatar", () => {
  it("is decorative, since the name is always written beside it", () => {
    const html = renderToStaticMarkup(<Avatar name="Tunde Bakare" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(">TB<");
    expect(html).toContain("bg-surface-sunken");
  });

  it("marks the signed-in person in brand colours", () => {
    expect(renderToStaticMarkup(<Avatar name="Ada Obi" current />)).toContain("bg-brand-soft");
  });
});
