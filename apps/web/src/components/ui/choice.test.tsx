import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox, Radio, Switch } from "./choice";

describe("Checkbox and Radio", () => {
  it("wrap a native control in a tap-sized label row", () => {
    const box = renderToStaticMarkup(<Checkbox label="Email me a daily digest" name="digest" />);
    expect(box).toMatch(/^<label[^>]*min-h-tap/);
    expect(box).toMatch(/<input[^>]*type="checkbox"[^>]*name="digest"/);
    expect(box).toContain("Email me a daily digest");
    expect(box).toContain("accent-brand");

    const radio = renderToStaticMarkup(<Radio label="Present" name="status" value="PRESENT" />);
    expect(radio).toMatch(/<input[^>]*type="radio"[^>]*name="status"[^>]*value="PRESENT"/);
  });
});

describe("Switch", () => {
  it("is a labelled switch reporting its state, for settings that apply at once", () => {
    const html = renderToStaticMarkup(
      <Switch
        label="Data saver"
        hint="Starts every video at the lowest quality."
        checked
        onCheckedChange={() => undefined}
      />,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toMatch(/<label[^>]*for="([^"]+)"[^>]*>Data saver<\/label>/);
    expect(html).toContain("Starts every video at the lowest quality.");
  });
});
