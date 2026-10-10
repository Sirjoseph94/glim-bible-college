import { expect, test, type Page } from "./test";
import { testPhoto } from "./images";
import { openCourse, openTeaching, signOut } from "./nav";

const LECTURER = { email: "e2e-lecturer@glim.test", password: "lecturer passphrase 2026" };
const STUDENT = { email: "e2e-student2@glim.test", password: "student passphrase 2026" };

/**
 * A stand-in for YouTube's IFrame API: the test drives the player through `window.__yt` (its
 * clock, duration and state changes) and sees where it was asked to seek.
 */
const IFRAME_API_STUB = `
window.__yt = { time: 0, duration: 600, seeks: [], fire: function () {} };
window.YT = {
  Player: function (element, options) {
    var player = {
      getCurrentTime: function () { return window.__yt.time; },
      getDuration: function () { return window.__yt.duration; },
      seekTo: function (s) { window.__yt.seeks.push(s); window.__yt.time = s; },
      destroy: function () {},
    };
    window.__yt.fire = function (state) {
      options.events.onStateChange({ data: state, target: player });
    };
    setTimeout(function () { options.events.onReady({ target: player }); }, 0);
    return player;
  },
};
setTimeout(function () { window.onYouTubeIframeAPIReady(); }, 0);
`;

async function stubYouTube(page: Page): Promise<string[]> {
  const youtube: string[] = [];
  page.on("request", (req) => {
    if (/youtube(-nocookie)?\.com/.test(req.url())) youtube.push(req.url());
  });
  await page.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({ contentType: "text/javascript", body: IFRAME_API_STUB }),
  );
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>player</title>" }),
  );
  await page.route("https://i.ytimg.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: testPhoto(32, 18) }),
  );
  return youtube;
}

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible();
}

test("a student watches a recording on a phone and resumes where they stopped", async ({
  page,
}) => {
  // The Lecturer (signed up in the meetings spec) adds a published recording.
  await signIn(page, LECTURER);
  await openTeaching(page, "Pastoral Care", "Recordings");
  await page.getByLabel(/^YouTube link/).fill("https://youtu.be/e2eWatch001");
  await page
    .getByLabel(/^Title/)
    .last()
    .fill("Week 2: Prayer");
  await page.getByRole("button", { name: "Add recording" }).click();
  await expect(page.getByRole("listitem", { name: "Week 2: Prayer" })).toContainText("Published");
  await signOut(page);

  // The online student (seeded with a password) signs in.
  await signIn(page, STUDENT);

  const youtube = await stubYouTube(page);
  await openCourse(page, "Pastoral Care", "Recordings");
  await page.getByRole("link", { name: "Week 2: Prayer" }).click();

  // Only the thumbnail until the student taps play.
  const facade = page.getByRole("button", { name: "Play recording" });
  await expect(facade).toBeVisible();
  await expect(page.getByText(/→ Quality → 144p/)).toBeVisible();
  expect(youtube).toEqual([]);

  await facade.click();
  const frame = page.locator('iframe[title="Week 2: Prayer"]');
  await expect(frame).toBeVisible();
  const src = new URL((await frame.getAttribute("src")) ?? "");
  expect(src.origin).toBe("https://www.youtube-nocookie.com");
  expect(src.pathname).toBe("/embed/e2eWatch001");
  expect(src.searchParams.get("rel")).toBe("0");
  expect(src.searchParams.get("playsinline")).toBe("1");
  expect(src.searchParams.get("start")).toBeNull();
  expect(youtube).toContain("https://www.youtube.com/iframe_api");

  // Watch to 2:05 and pause: the position is saved.
  await page.waitForFunction(() => "__yt" in window);
  const saved = page.waitForResponse(
    (res) => res.url().endsWith("/progress") && res.request().method() === "PATCH",
  );
  await page.evaluate(() => {
    const yt = (window as unknown as { __yt: { time: number; fire: (s: number) => void } }).__yt;
    yt.time = 125;
    yt.fire(2);
  });
  const progress = await saved;
  expect(progress.status()).toBe(200);
  expect(progress.request().postDataJSON()).toMatchObject({
    positionMs: 125_000,
    durationMs: 600_000,
  });

  // Coming back resumes there, and the tip now knows how long the video is.
  await page.reload();
  const resume = page.getByRole("button", { name: "Resume from 2:05" });
  await expect(resume).toBeVisible();
  await expect(page.getByText(/uses about 7 MB at 144p or 12 MB at 240p/)).toBeVisible();
  await resume.click();
  const resumed = new URL((await frame.getAttribute("src")) ?? "");
  expect(resumed.searchParams.get("start")).toBe("125");
});
