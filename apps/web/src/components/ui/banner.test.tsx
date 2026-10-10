import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Banner } from "./banner";

const ICON = {
  info: 'd="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.5v.5"',
  check: 'd="M5 12.5 10 17l9-10"',
  alert: 'd="M12 3 2 20h20zM12 10v4M12 17v.5"',
  wifiOff: 'd="M3 3l18 18M8.5 12.5',
};

describe("Banner", () => {
  it("interrupts for errors and waits politely for everything else (§9.4, §13)", () => {
    expect(renderToStaticMarkup(<Banner tone="danger">x</Banner>)).toContain('role="alert"');
    for (const tone of ["info", "success", "warning", "offline"] as const)
      expect(renderToStaticMarkup(<Banner tone={tone}>x</Banner>)).toContain('role="status"');
  });

  it("pairs each tone with its icon", () => {
    expect(renderToStaticMarkup(<Banner tone="info">x</Banner>)).toContain(ICON.info);
    expect(renderToStaticMarkup(<Banner tone="success">x</Banner>)).toContain(ICON.check);
    expect(renderToStaticMarkup(<Banner tone="warning">x</Banner>)).toContain(ICON.alert);
    expect(renderToStaticMarkup(<Banner tone="danger">x</Banner>)).toContain(ICON.alert);
    expect(renderToStaticMarkup(<Banner tone="offline">x</Banner>)).toContain(ICON.wifiOff);
  });

  it("shows a title, the message, an action, and a labelled dismiss button", () => {
    const html = renderToStaticMarkup(
      <Banner
        tone="warning"
        title="Link your Google account"
        action={<button type="button">Link</button>}
        onDismiss={() => undefined}
      >
        You need it to join live classes.
      </Banner>,
    );
    expect(html).toContain("Link your Google account");
    expect(html).toContain("You need it to join live classes.");
    expect(html).toContain(">Link</button>");
    expect(html).toContain('aria-label="Dismiss"');
  });
});
