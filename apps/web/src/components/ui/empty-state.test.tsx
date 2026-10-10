import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("says what's missing, why, and offers one way on", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        icon="calendar"
        title="No classes today"
        action={<a href="/schedule">See your week</a>}
      >
        Your next class is Tue 13 Oct, 10:00.
      </EmptyState>,
    );
    expect(html).toMatch(/<h2[^>]*>No classes today<\/h2>/);
    expect(html).toContain("Your next class is Tue 13 Oct, 10:00.");
    expect(html).toContain(">See your week</a>");
  });

  it("can sit under a page's own heading at a lower level", () => {
    const html = renderToStaticMarkup(
      <EmptyState icon="info" title="Nothing due" headingLevel={3}>
        Your Lecturer hasn&apos;t set any work yet.
      </EmptyState>,
    );
    expect(html).toMatch(/<h3[^>]*>Nothing due<\/h3>/);
  });
});
