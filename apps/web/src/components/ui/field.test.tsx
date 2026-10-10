import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select, TextField } from "./field";

describe("TextField", () => {
  it("binds a visible label to the input (never a placeholder label)", () => {
    const html = renderToStaticMarkup(<TextField id="email" label="Email" type="email" />);
    expect(html).toMatch(/<label[^>]*for="email"[^>]*>Email<\/label>/);
    expect(html).toMatch(/<input[^>]*id="email"/);
    expect(html).toContain("h-control");
    expect(html).toContain("text-body");
  });

  it("marks optional fields in the label text", () => {
    expect(renderToStaticMarkup(<TextField id="n" label="Middle name" optional />)).toContain(
      "(optional)",
    );
  });

  it("links the hint, and an error replaces it, marking the input invalid", () => {
    const hinted = renderToStaticMarkup(<TextField id="a" label="Answer" hint="412 words" />);
    expect(hinted).toContain('aria-describedby="a-hint"');
    expect(hinted).toMatch(/id="a-hint"[^>]*>412 words/);
    expect(hinted).not.toContain("aria-invalid=");

    const failed = renderToStaticMarkup(
      <TextField id="a" label="Answer" hint="412 words" error="Write at least 500 words." />,
    );
    expect(failed).toContain('aria-invalid="true"');
    expect(failed).toContain('aria-describedby="a-error"');
    expect(failed).toMatch(/id="a-error"[^>]*>.*Write at least 500 words\./);
    expect(failed).not.toContain("412 words");
  });

  it("is a resizable text area when multiline", () => {
    const html = renderToStaticMarkup(<TextField id="t" label="Your answer" multiline rows={8} />);
    expect(html).toMatch(/<textarea[^>]*id="t"/);
    expect(html).toContain('rows="8"');
    expect(html).not.toContain("<input");
  });
});

describe("Select", () => {
  it("is a native select with a bound label, styled like a text field", () => {
    const html = renderToStaticMarkup(
      <Select id="level" label="Level">
        <option>Year 1</option>
      </Select>,
    );
    expect(html).toMatch(/<label[^>]*for="level"/);
    expect(html).toMatch(/<select[^>]*id="level"/);
    expect(html).toContain("h-control");
  });
});
