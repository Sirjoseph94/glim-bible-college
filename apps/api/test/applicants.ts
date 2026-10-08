import type { Application, Me } from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import type { FakeGoogleUser, FakeOidcIssuer } from "@glim/integrations/oidc/fake-issuer";
import { NotificationsService } from "@glim/modules/notifications";
import { expect } from "vitest";
import { cookieValue, viaGoogle } from "./google-flow";
import type { TestApp } from "./harness";
import { uploadPhoto } from "./uploads";

/** Every required answer, as a complete applicant would give them. */
export const COMPLETE = (name: string, extra: { spiritual?: object } = {}) => ({
  personal: {
    firstName: name,
    lastName: "Okafor",
    title: "MR",
    gender: "MALE",
    dateOfBirth: "1988-02-14",
    maritalStatus: "MARRIED",
    nationality: "Nigerian",
    occupation: "Farmer",
  },
  contact: { email: `${name.toLowerCase()}.mail@gmail.com`, phoneWhatsapp: "+2348031234567" },
  address: { country: "Nigeria", stateProvince: "Enugu", city: "Nsukka", address: "1 Market Road" },
  church: {
    churchName: "Grace Chapel",
    churchAddress: "2 Church Street",
    pastorName: "Pastor Obi",
    pastorPhone: "+2348039876543",
  },
  spiritual: {
    bornAgain: true,
    bornAgainWhen: "2005",
    waterBaptism: "Yes, 2006",
    holySpiritBaptism: false,
    ...extra.spiritual,
  },
  feedback: { heardVia: ["FRIEND"] },
  declaration: { fullName: `${name} Okafor`, statementOfFaithRead: true, declared: true },
  consent: { consented: true },
});

let keys = 0;
/** A fresh Idempotency-Key. */
export const idempotencyKey = () => `test-key-${String(++keys).padStart(10, "0")}`;

/**
 * Drives the applicant's side of the API in tests: sign up from /apply, start, save, complete
 * and submit applications, and send queued emails.
 */
export function applicantKit(t: TestApp, issuer: FakeOidcIssuer, defaultProgrammeId: () => string) {
  /** Signs up (or back in) from /apply, returning headers that act as that applicant. */
  async function signUp(user: FakeGoogleUser): Promise<Record<string, string>> {
    const res = await viaGoogle(t, issuer, user, {
      intent: "apply",
      returnTo: "/application/edit",
    });
    expect(res.headers.location).toBe("/application/edit");
    const cookie = cookieValue(res, "__Host-glim_sid") ?? "";
    const me = await t.request({ url: "/api/v1/me", headers: { cookie } });
    return { cookie, "x-csrf-token": me.json<Me>().csrfToken };
  }

  function start(headers: Record<string, string>, programmeId = defaultProgrammeId()) {
    return t.request({
      method: "POST",
      url: "/api/v1/applications",
      headers,
      payload: { programmeId, studyMode: "ONLINE" },
    });
  }

  function save(
    headers: Record<string, string>,
    application: { id: string; version: number },
    payload: unknown,
  ) {
    return t.request({
      method: "PATCH",
      url: `/api/v1/applications/${application.id}`,
      headers: { ...headers, "if-match": `"${String(application.version)}"` },
      payload,
    });
  }

  /** A new applicant with a complete draft (photo included), ready to submit. */
  async function complete(
    name: string,
    extra?: { spiritual?: object },
  ): Promise<{ headers: Record<string, string>; application: Application }> {
    const headers = await signUp({
      sub: `google-${name.toLowerCase()}`,
      email: `${name.toLowerCase()}@gmail.com`,
    });
    let application = (await start(headers)).json<Application>();
    const photo = await uploadPhoto(t, headers);
    application = (
      await save(headers, application, { ...COMPLETE(name, extra), photo: { fileId: photo.id } })
    ).json<Application>();
    expect(Object.values(application.missing).flat()).toEqual([]);
    return { headers, application };
  }

  function submit(headers: Record<string, string>, id: string, key = idempotencyKey()) {
    return t.request({
      method: "POST",
      url: `/api/v1/applications/${id}/submit`,
      headers: { ...headers, "idempotency-key": key },
    });
  }

  /** Runs the queued notify.send jobs, as the worker would. */
  function sendQueuedEmails() {
    const notifications = t.app.get(NotificationsService);
    return drainQueues(t.boss, {
      "notify.send": (job) =>
        notifications.deliver((job.data as { notificationId: string }).notificationId),
    });
  }

  /** An officer opens the application for review and admits it. */
  async function admit(applicationId: string, officerHeaders: Record<string, string>) {
    await t.request({
      method: "POST",
      url: `/api/v1/admissions/applications/${applicationId}/review`,
      headers: officerHeaders,
    });
    const decided = await t.request({
      method: "POST",
      url: `/api/v1/admissions/applications/${applicationId}/decide`,
      headers: { ...officerHeaders, "idempotency-key": idempotencyKey() },
      payload: { decision: "ADMIT" },
    });
    expect(decided.statusCode, decided.body).toBe(200);
  }

  return { signUp, start, save, complete, submit, admit, sendQueuedEmails };
}
