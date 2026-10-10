import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Skeleton, SkeletonGroup } from "./skeleton";

describe("Skeleton", () => {
  it("is a still block, hidden from screen readers (no shimmer, §8)", () => {
    const html = renderToStaticMarkup(<Skeleton className="h-4 w-3/4" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("bg-surface-sunken");
    expect(html).not.toContain("animate");
  });

  it("announces once, for the whole region, what is loading", () => {
    const html = renderToStaticMarkup(
      <SkeletonGroup label="Loading your courses">
        <Skeleton className="h-4" />
      </SkeletonGroup>,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading your courses");
  });
});
