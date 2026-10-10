import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Icon, type IconName } from "./icons";

describe("Icon", () => {
  it("draws the named icon as a decorative 20px stroke SVG by default", () => {
    const svg = renderToStaticMarkup(<Icon name="check" />);
    expect(svg).toContain('d="M5 12.5 10 17l9-10"');
    expect(svg).toContain('width="20"');
    expect(svg).toContain('height="20"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('stroke-width="1.75"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toContain("role=");
  });

  it("is announced as an image with its label when it carries meaning on its own", () => {
    const svg = renderToStaticMarkup(<Icon name="alert" size={16} label="Overdue" />);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Overdue"');
    expect(svg).not.toContain("aria-hidden");
    expect(svg).toContain('width="16"');
  });

  it("fills the play glyph, the one solid icon in the set", () => {
    const svg = renderToStaticMarkup(<Icon name="play" size={30} />);
    expect(svg).toContain('d="M8 5v14l11-7z"');
    expect(svg).toContain('fill="currentColor"');
  });

  it("falls back to the info icon for a name it doesn't know, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const svg = renderToStaticMarkup(<Icon name={"sparkle" as IconName} />);
    expect(svg).toContain('d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.5v.5"');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sparkle"));
    warn.mockRestore();
  });
});
