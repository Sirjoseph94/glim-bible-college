/** Outgoing email (TRD §15.1). Adapters: SendGrid (production), SMTP (Mailpit in development), memory (tests). */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Category for delivery analytics; never personal data. */
  category?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol("Mailer");
