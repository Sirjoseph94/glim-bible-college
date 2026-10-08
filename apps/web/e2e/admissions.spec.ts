import { expect, test } from "@playwright/test";
import { testPhoto } from "./images";
import { lastEmail, linkToken, nextGoogleSignIn } from "./mailbox";

const EMAIL = "e2e-admissions@glim.test";
const PASSWORD = "admissions passphrase 2026";

test("an Admissions Officer opens the intake, an applicant starts applying, and the intake closes", async ({
  browser,
  page,
}) => {
  await page.goto(`/invite/${await linkToken(EMAIL, "invite")}`);
  await page.getByLabel("New password (at least 12 characters)").fill(PASSWORD);
  await page.getByLabel("Confirm the new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Amaka Admissions" })).toBeVisible();

  await page.getByRole("link", { name: "Admissions" }).click();
  await page.getByRole("link", { name: "Intakes" }).click();
  await page.getByLabel("Intake (year students start, e.g. 2027)").fill("2030");
  await page
    .getByLabel("Academic Session students start in")
    .selectOption({ label: "2030/2031 Session" });
  await page.getByLabel("Applications open (November)").fill("2029-11-01");
  await page.getByLabel("Applications close (June)").fill("2030-06-30");
  await page.getByRole("button", { name: "Plan intake" }).click();
  await expect(page.getByText("Intake 2030 · 2030/2031 Session")).toBeVisible();
  await page.getByRole("button", { name: "Open now" }).click();
  await expect(page.getByText("open", { exact: true })).toBeVisible();

  // An applicant, in a browser of their own without the officer's session.
  const applicant = await (
    await browser.newContext({ baseURL: new URL(page.url()).origin })
  ).newPage();
  await applicant.goto("/apply");
  await expect(
    applicant.getByText("Applications for the 2030/2031 Session are open until"),
  ).toBeVisible();
  await expect(applicant.getByText("Sun, 30 Jun 2030")).toBeVisible();
  await expect(applicant.getByRole("link", { name: "Create one free" })).toBeVisible();

  // The applicant signs up with Google from /apply and starts their application.
  await nextGoogleSignIn({
    sub: "e2e-applicant-sub",
    email: "chioma.applicant@gmail.com",
    name: "Chioma Eze",
  });
  await applicant.getByRole("link", { name: "Apply with Google" }).click();
  await expect(applicant.getByRole("heading", { name: "Start your application" })).toBeVisible();
  await applicant.getByLabel("Diploma in Ministry").check();
  await applicant.getByLabel("Online").check();
  await applicant.getByRole("button", { name: "Start my application" }).click();
  await expect(applicant.getByRole("heading", { name: "1. Personal information" })).toBeVisible();

  // Autosave: too young is refused with a reason; a corrected answer saves.
  const saved = applicant.getByText("Saved", { exact: true });
  await applicant.getByLabel("First name").fill("Chioma");
  await applicant.getByLabel("Last name").fill("Eze");
  await applicant.getByLabel("Date of birth").fill("2015-01-01");
  await expect(applicant.getByText("Not saved — check the answers marked below")).toBeVisible({
    timeout: 15_000,
  });
  await expect(applicant.getByText(/You must be at least 18/).last()).toBeVisible();
  await applicant.getByLabel("Date of birth").fill("1995-05-20");
  await expect(saved).toBeVisible({ timeout: 15_000 });

  // The email is filled in from Google and can be changed.
  await applicant.getByRole("button", { name: "Next" }).click();
  await expect(applicant.getByLabel("Email")).toHaveValue("chioma.applicant@gmail.com");

  // Leaving and coming back resumes at the first unfinished section, with the answers kept.
  await applicant.reload();
  await expect(applicant.getByRole("heading", { name: "1. Personal information" })).toBeVisible();
  await expect(applicant.getByLabel("First name")).toHaveValue("Chioma");
  await expect(applicant.getByRole("link", { name: "My application" })).toBeVisible();

  // The passport photo is shrunk on the phone and uploads over a slow mobile connection.
  const network = await applicant.context().newCDPSession(applicant);
  await network.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (200 * 1024) / 8,
  });
  await applicant.getByRole("button", { name: /Passport photo/ }).click();
  await applicant.getByLabel("Choose a photo").setInputFiles({
    name: "selfie.png",
    mimeType: "image/png",
    buffer: testPhoto(),
  });
  await expect(applicant.getByText("Saved", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(applicant.getByRole("button", { name: /Passport photo.*complete/ })).toBeVisible();
  await network.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  // Back later, the photo comes from the private bucket, already cropped and shrunk.
  await applicant.reload();
  await applicant.getByRole("button", { name: /Passport photo/ }).click();
  const photo = applicant.getByRole("img", { name: "Your passport photo" });
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]))
    .toEqual([467, 600]);

  // The applicant finishes every section, reviews and submits.
  const next = () => applicant.getByRole("button", { name: "Next" }).click();
  await applicant.getByRole("button", { name: /1\. Personal information/ }).click();
  await applicant.getByLabel("Title").selectOption("Mrs");
  await applicant.getByLabel("Gender").selectOption("Female");
  await applicant.getByLabel("Marital status").selectOption("Married");
  await applicant.getByLabel("Nationality").fill("Nigerian");
  await applicant.getByLabel("Present occupation").fill("Nurse");
  await next();
  await applicant.getByLabel("Mobile phone (WhatsApp)").fill("+234 803 123 4567");
  await next();
  await applicant.getByLabel("Country of residence").fill("Nigeria");
  await applicant.getByLabel("State or province").fill("Anambra");
  await applicant.getByLabel("City").fill("Awka");
  await applicant.getByLabel("Address", { exact: true }).fill("5 Zik Avenue");
  await next();
  await applicant.getByLabel("Church name").fill("Grace Chapel");
  await applicant.getByLabel("Church address").fill("2 Church Street, Awka");
  await applicant.getByLabel("Pastor's name").fill("Pastor Obi");
  await applicant.getByLabel("Pastor's phone").fill("+234 803 987 6543");
  await next();
  await applicant.getByRole("group", { name: "Are you born again?" }).getByLabel("Yes").check();
  await applicant.getByLabel("When?").fill("2010");
  await applicant.getByLabel("Have you been baptised in water by immersion?").fill("Yes, in 2011");
  await applicant
    .getByRole("group", { name: /baptised in the Holy Spirit/ })
    .getByLabel("No")
    .check();
  await next();
  await applicant.getByLabel("A friend").check();
  await next();
  await applicant.getByLabel("Type your full name to sign").fill("Chioma Eze");
  await applicant
    .getByLabel(/I have read the GLIM Online Bible College Statement of Faith/)
    .check();
  await applicant.getByLabel("I make the declaration above").check();
  await next();
  await applicant.getByLabel("I give the consent above").check();
  await next();
  await next();
  await expect(applicant.getByRole("heading", { name: "Review and submit" })).toBeVisible();
  await expect(applicant.getByText("Everything's answered.", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await applicant.getByRole("button", { name: "Submit application" }).click();

  // The status page shows the reference number, and a receipt arrives by email.
  await expect(applicant.getByText("Application Reference No: GLIM-APP-2030-00001")).toBeVisible();
  await expect(applicant.getByText("Status: Submitted")).toBeVisible();
  await expect
    .poll(async () => (await lastEmail("chioma.applicant@gmail.com"))?.subject, { timeout: 15_000 })
    .toBe("We've received your application GLIM-APP-2030-00001");

  // The Admissions Officer opens it (marking it Under Review), sees every section, and admits.
  await page.getByRole("link", { name: "Admissions" }).click();
  await page.getByRole("link", { name: "Chioma Eze" }).click();
  await expect(page.getByText("Status: Under review")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "5. Spiritual background (confidential)" }),
  ).toBeVisible();
  await page.getByLabel("Internal note (never sent to the applicant)").fill("Clear calling");
  await page.getByRole("button", { name: "Admit", exact: true }).click();
  await page.getByRole("button", { name: "Yes, admit" }).click();
  await expect(page.getByText("Status: Admitted: offer made")).toBeVisible();
  await expect
    .poll(async () => (await lastEmail("chioma.applicant@gmail.com"))?.subject, {
      timeout: 15_000,
    })
    .toBe("Your offer of a place at GLIM Online Bible College");
  await applicant.reload();
  await expect(applicant.getByText("Status: Admitted: offer made")).toBeVisible();
  await expect(applicant.getByText(/days, \d+ hours? left/)).toBeVisible();

  // Accepting makes them a student with a Matric Number at once, and a welcome email follows.
  await applicant.getByRole("button", { name: "Accept offer" }).click();
  await expect(applicant.getByText("Your Matric Number is GLIM/DMIN/2030/0001")).toBeVisible();
  await expect
    .poll(async () => (await lastEmail("chioma.applicant@gmail.com"))?.subject, {
      timeout: 15_000,
    })
    .toBe("Welcome to GLIM Online Bible College: your Matric Number is GLIM/DMIN/2030/0001");

  await page.getByRole("link", { name: "Admissions" }).click();
  await page.getByRole("link", { name: "Intakes" }).click();
  await page.getByRole("button", { name: "Close now" }).click();
  await expect(page.getByText("closed", { exact: true })).toBeVisible();
  await applicant.goto("/apply");
  await expect(
    applicant.getByText("Applications for the 2030/2031 Session are closed."),
  ).toBeVisible();
});
