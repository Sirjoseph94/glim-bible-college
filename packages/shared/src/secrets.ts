import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Secrets kept in the database (the YouTube channel's refresh token, TRD §22.3): AES-256-GCM
 * under `TOKEN_ENCRYPTION_KEY`, stored as `v1.<iv>.<tag>.<ciphertext>` in base64url. Tampering
 * or the wrong key makes `openSecret` throw.
 */
export function sealSecret(key: Buffer, plaintext: string): string {
  if (key.length !== 32) throw new Error("The token key must be 32 bytes.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function openSecret(key: Buffer, sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== "v1" || iv === undefined || tag === undefined || ciphertext === undefined)
    throw new Error("Not a sealed secret.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
