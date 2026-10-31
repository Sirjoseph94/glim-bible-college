import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GpaSummary, ResultRow } from "./results";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("GpaSummary (handoff §9.17)", () => {
  it("shows the CGPA to two decimals and the credits earned, with the results' status", () => {
    const html = renderToStaticMarkup(
      <GpaSummary cgpaX100={395} provisional earnedX10={180} attemptedX10={180} />,
    );
    expect(text(html)).toContain("CGPA 3.95");
    expect(text(html)).toContain("Provisional");
    expect(text(html)).toContain("18 of 18 credits earned");
  });

  it("says Approved once the Registrar has approved every result", () => {
    const html = renderToStaticMarkup(
      <GpaSummary cgpaX100={500} provisional={false} earnedX10={30} attemptedX10={30} />,
    );
    expect(text(html)).toContain("Approved");
    expect(text(html)).not.toContain("Provisional");
  });

  it("shows a dash and No results yet before any result is finalized", () => {
    const html = renderToStaticMarkup(<GpaSummary cgpaX100={null} />);
    expect(text(html)).toContain("CGPA —");
    expect(text(html)).toContain("No results yet");
  });
});

describe("ResultRow (handoff §9.17)", () => {
  it("shows the course, credits, letter and percentage", () => {
    const html = renderToStaticMarkup(
      <ResultRow code="BTH 301" title="Kings of Judah" creditsX10={30} letter="A" pctX100={8350} />,
    );
    expect(text(html)).toContain("BTH 301 · 3 credits");
    expect(text(html)).toContain("Kings of Judah");
    expect(html).toMatch(/<strong[^>]*>A<\/strong>/);
    expect(text(html)).toContain("84%");
  });

  it("rounds percentages to whole numbers, keeping decimals only under 1% (§10.6)", () => {
    const pct = (pctX100: number) =>
      text(
        renderToStaticMarkup(
          <ResultRow code="X" title="Y" creditsX10={10} letter="F" pctX100={pctX100} />,
        ),
      );
    expect(pct(8349)).toContain("83%");
    expect(pct(10000)).toContain("100%");
    expect(pct(50)).toContain("0.50%");
  });

  it("marks a result that isn't in yet as Awaiting", () => {
    const html = renderToStaticMarkup(
      <ResultRow code="GRK 301" title="Greek" creditsX10={30} letter={null} pctX100={null} />,
    );
    expect(html).toMatch(/<strong[^>]*>—<\/strong>/);
    expect(text(html)).toContain("Awaiting");
  });
});
