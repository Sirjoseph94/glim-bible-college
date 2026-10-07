import type { MailMessage, Mailer } from "./port";

/** Keeps sent messages in memory so tests can read them. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** The most recent message sent to an address. */
  lastTo(address: string): MailMessage | undefined {
    return this.sent.findLast((m) => m.to.toLowerCase() === address.toLowerCase());
  }

  clear(): void {
    this.sent.length = 0;
  }
}
