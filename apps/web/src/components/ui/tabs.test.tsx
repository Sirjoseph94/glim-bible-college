import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tabs } from "./tabs";

describe("Tabs", () => {
  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "recordings", label: "Recordings" },
    { value: "work", label: "Work", count: 2 },
  ];

  it("renders a tablist with the selected tab and only its panel", () => {
    const html = renderToStaticMarkup(
      <Tabs label="Course sections" tabs={tabs} value="recordings" onValueChange={() => undefined}>
        {(value) => <p>panel {value}</p>}
      </Tabs>,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Course sections"');
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Recordings/);
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("panel recordings");
  });

  it("shows a count only where something needs action", () => {
    const html = renderToStaticMarkup(
      <Tabs label="x" tabs={tabs} value="overview" onValueChange={() => undefined}>
        {() => null}
      </Tabs>,
    );
    expect(html).toMatch(/Work<span[^>]*>2<\/span>/);
    expect(html).not.toMatch(/Overview<span/);
  });
});
