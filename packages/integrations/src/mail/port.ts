/** Outgoing email (TRD §15.1). Adapters: SMTP (Brevo in production, Mailpit in development), SendGrid, memory (tests). */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Category for delivery analytics; never personal data. */
  category?: string;
  /** Files sent with the message (e.g. a transcript PDF, ≤ 5 MB). */
  attachments?: MailAttachment[];
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol("Mailer");
