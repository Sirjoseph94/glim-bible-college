import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfflineBanner, QueuedPill, queuedLabel } from "./offline";

describe("queuedLabel", () => {
  it("counts what is waiting, in plain words (§9.20)", () => {
    expect(queuedLabel(1, ["submission", "submissions"])).toBe("1 submission waiting to send");
    expect(queuedLabel(3, ["mark", "marks"])).toBe("3 marks waiting to send");
  });
});

describe("offline indicators", () => {
  it("says the work is safe and will send, without blaming anyone", () => {
    const html = renderToStaticMarkup(<OfflineBanner />);
    expect(html).toContain('role="status"');
    expect(html).toContain("You are offline");
    expect(html).toContain("Your work is saved on this phone and will send when you reconnect.");
  });

  it("shows nothing when nothing is queued", () => {
    expect(renderToStaticMarkup(<QueuedPill count={0} noun={["answer", "answers"]} />)).toBe("");
    expect(renderToStaticMarkup(<QueuedPill count={2} noun={["answer", "answers"]} />)).toContain(
      "2 answers waiting to send",
    );
  });
});
