import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("is a plain button that won't submit a form by accident", () => {
    const html = renderToStaticMarkup(<Button>Try again</Button>);
    expect(html).toMatch(/^<button[^>]*type="button"/);
    expect(html).toContain(">Try again</button>");
  });

  it("keeps its label while busy, shows a spinner instead of the icon, and blocks clicks", () => {
    const html = renderToStaticMarkup(
      <Button variant="primary" icon="upload" loading>
        Submit assignment
      </Button>,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("glim-spinner");
    expect(html).not.toContain('d="M12 21V9M7 14l5-5 5 5M4 4h16"');
    expect(html).toContain("Submit assignment");
  });

  it("shows its leading icon when not busy", () => {
    const html = renderToStaticMarkup(<Button icon="upload">Attach a file</Button>);
    expect(html).toContain('d="M12 21V9M7 14l5-5 5 5M4 4h16"');
    expect(html).not.toContain("aria-busy");
  });

  it("styles a link as a button with asChild, so navigation stays a link", () => {
    const html = renderToStaticMarkup(
      <Button asChild variant="secondary">
        <a href="/recordings/1">Watch recording</a>
      </Button>,
    );
    expect(html).toMatch(/^<a [^>]*href="\/recordings\/1"/);
    expect(html).toContain("border-line-strong");
    expect(html).not.toContain("<button");
  });

  it("keeps its leading icon when styled onto a link", () => {
    const html = renderToStaticMarkup(
      <Button asChild icon="play">
        <a href="/recordings/1">Watch recording</a>
      </Button>,
    );
    expect(html).toMatch(/^<a [^>]*><svg[^>]*>.*M8 5v14l11-7z.*<\/svg>Watch recording<\/a>$/);
  });
});
