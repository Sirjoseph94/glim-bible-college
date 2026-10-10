import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./progress-bar";

describe("ProgressBar", () => {
  it("is a labelled progressbar with its value, and shows the rounded percentage", () => {
    const html = renderToStaticMarkup(<ProgressBar label="Recordings watched" value={41.6} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Recordings watched"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain(">42%<");
    expect(html).toContain("width:42%");
  });

  it("keeps the fill inside the track for out-of-range values", () => {
    expect(renderToStaticMarkup(<ProgressBar label="x" value={140} />)).toContain("width:100%");
    expect(renderToStaticMarkup(<ProgressBar label="x" value={-5} />)).toContain("width:0%");
  });

  it("drops the label row in the thin variant used inside list rows", () => {
    const html = renderToStaticMarkup(<ProgressBar label="Watched" value={30} thin />);
    expect(html).toContain('aria-label="Watched"');
    expect(html).not.toContain(">30%<");
  });
});
