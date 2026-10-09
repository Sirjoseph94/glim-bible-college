import type { TranscriptSnapshot } from "@glim/contracts";

/** What a transcript PDF is drawn from: the frozen snapshot and how to check it (§14.7). */
export interface TranscriptRenderInput {
  snapshot: TranscriptSnapshot;
  serialNo: string;
  verificationCode: string;
  snapshotSha256: string;
  /** `https://<app>/verify/<code>`, printed and encoded in the QR code. */
  verifyUrl: string;
}

/** Renders transcripts as A4 PDFs (TRD §14.7). Adapter: @react-pdf/renderer (S-16). */
export interface TranscriptRenderer {
  render(input: TranscriptRenderInput): Promise<Uint8Array>;
}

export const TRANSCRIPT_RENDERER = Symbol.for("glim.TranscriptRenderer");
