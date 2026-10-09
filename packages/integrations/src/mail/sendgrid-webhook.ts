import { createPublicKey, verify } from "node:crypto";

/** SendGrid's signed Event Webhook headers (ECDSA P-256 over `timestamp + body`). */
export const SIGNATURE_HEADER = "x-twilio-email-event-webhook-signature";
export const TIMESTAMP_HEADER = "x-twilio-email-event-webhook-timestamp";

/** How old a signed delivery may be before it's refused as a replay. */
const MAX_AGE_SECONDS = 10 * 60;

/**
 * Checks a SendGrid Event Webhook delivery (TRD §15.1): the base64 DER signature must verify
 * against the account's public key (base64 DER, as SendGrid shows it) over the timestamp followed
 * by the exact raw body, and the timestamp must be recent.
 */
export function verifySendgridSignature(input: {
  publicKey: string;
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
  now: Date;
}): boolean {
  const { signature, timestamp } = input;
  if (signature === undefined || timestamp === undefined || !/^\d{1,12}$/.test(timestamp))
    return false;
  if (Math.abs(input.now.getTime() / 1000 - Number(timestamp)) > MAX_AGE_SECONDS) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(input.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(
      "sha256",
      Buffer.from(timestamp + input.rawBody, "utf8"),
      { key, dsaEncoding: "der" },
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
