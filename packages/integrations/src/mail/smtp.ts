import { createTransport } from "nodemailer";
import type { MailMessage, Mailer } from "./port";

/** SMTP delivery, used with Mailpit in local development. */
export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(url);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html === undefined ? {} : { html: message.html }),
      ...(message.attachments === undefined
        ? {}
        : {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              contentType: a.contentType,
              content: Buffer.from(a.content),
            })),
          }),
    });
  }
}
