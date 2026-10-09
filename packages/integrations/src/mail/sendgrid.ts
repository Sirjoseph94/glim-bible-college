import type { MailMessage, Mailer } from "./port";

const ENDPOINT = "https://api.sendgrid.com/v3/mail/send";

/** Parses `Name <address>` or a bare address. */
function parseFrom(from: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!match) return { email: from.trim() };
  const [, name = "", email = ""] = match;
  return name === "" ? { email } : { email, name };
}

/** SendGrid v3 Mail Send over HTTPS (production). */
export class SendGridMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const content = [{ type: "text/plain", value: message.text }];
    if (message.html !== undefined) content.push({ type: "text/html", value: message.html });
    const res = await this.fetchFn(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: parseFrom(this.from),
        subject: message.subject,
        content,
        ...(message.category === undefined ? {} : { categories: [message.category] }),
        ...(message.attachments === undefined
          ? {}
          : {
              attachments: message.attachments.map((a) => ({
                content: Buffer.from(a.content).toString("base64"),
                filename: a.filename,
                type: a.contentType,
                disposition: "attachment",
              })),
            }),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // The body may echo the request; report only the status (INV-12).
      throw new Error(`SendGrid rejected the message (HTTP ${String(res.status)})`);
    }
  }
}
