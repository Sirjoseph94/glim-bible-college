import type { Mailer } from "./port";
import { SendGridMailer } from "./sendgrid";
import { SmtpMailer } from "./smtp";
import type { Config } from "@glim/shared/config";

/** Binds the Mailer port: SendGrid in production, SMTP (Mailpit) locally (TRD §22.3). */
export function createMailer(config: Config): Mailer {
  const { mail } = config;
  if (mail.provider === "sendgrid") {
    if (mail.sendgridApiKey === undefined)
      throw new Error("SENDGRID_API_KEY is required for MAIL_PROVIDER=sendgrid");
    return new SendGridMailer(mail.sendgridApiKey, mail.from);
  }
  if (mail.smtpUrl === undefined) throw new Error("SMTP_URL is required for MAIL_PROVIDER=smtp");
  return new SmtpMailer(mail.smtpUrl, mail.from);
}
