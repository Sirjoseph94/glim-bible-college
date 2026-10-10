import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge, type BadgeStatus } from "./badge";

/** The exact words (docs/ui-design-handoff.md §9.3, §12.2; NO_SHOW per decision UI-Q3). */
const WORDS: [BadgeStatus, string][] = [
  ["scheduled", "Scheduled"],
  ["open", "Open to join"],
  ["live", "Live now"],
  ["ended", "Ended"],
  ["no_show", "Didn't take place"],
  ["processing", "Recording processing"],
  ["available", "Recording ready"],
  ["cancelled", "Cancelled"],
  ["present", "Present"],
  ["partial", "Partial"],
  ["absent", "Absent"],
  ["excused", "Excused"],
  ["provisional", "Provisional"],
  ["approved", "Approved"],
  ["failed", "Failed"],
  ["draft", "Draft"],
];

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

describe("Badge", () => {
  it.each(WORDS)("says %s as “%s”", (status, word) => {
    expect(text(renderToStaticMarkup(<Badge status={status} />))).toBe(word);
  });

  it("marks only a live class with the live colour and a pulsing dot (UI-4)", () => {
    const live = renderToStaticMarkup(<Badge status="live" />);
    expect(live).toContain("bg-live");
    expect(live).toContain("glim-live-dot");
    for (const [status] of WORDS.filter(([s]) => s !== "live")) {
      const html = renderToStaticMarkup(<Badge status={status} />);
      expect(html).not.toContain("live");
    }
  });

  it("takes free text with an explicit tone for statuses outside the list", () => {
    const html = renderToStaticMarkup(<Badge tone="warning">To grade</Badge>);
    expect(text(html)).toBe("To grade");
    expect(html).toContain("bg-warning-soft");
  });
});
