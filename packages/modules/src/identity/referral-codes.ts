import { randomInt } from "node:crypto";

/** Uppercase base32 without look-alikes (no I, O, 0 or 1), so codes survive being read aloud. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LENGTH = 7;

/** A personal referral code (TRD §10.6), e.g. "K7QM2XP". */
export function generateReferralCode(): string {
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++)
    code += ALPHABET.charAt(randomInt(ALPHABET.length));
  return code;
}
