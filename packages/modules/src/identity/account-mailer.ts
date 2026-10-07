import { MAILER, type Mailer } from "@glim/integrations/mail/port";
import { CONFIG, type Config } from "@glim/shared/config";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import type { Recipient } from "./user.service";

/**
 * Account emails: invites and password resets. Sent after the transaction that issued the token
 * commits; tokens are never stored in plaintext, so they can't be re-sent from a job later.
 */
@Injectable()
export class AccountMailer {
  constructor(
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  inviteLink(token: string): string {
    return `${this.config.appOrigin}/invite/${token}`;
  }

  resetLink(token: string): string {
    return `${this.config.appOrigin}/reset/${token}`;
  }

  /** Returns false (and logs) if the email couldn't be handed to the mail provider. */
  async sendInvite(to: Recipient, token: string): Promise<boolean> {
    const link = this.inviteLink(token);
    return this.deliver({
      to: to.email,
      subject: "Your GLIM Bible College account",
      category: "account-invite",
      text: [
        `Hello ${to.displayName},`,
        "",
        "An account has been created for you on the GLIM Bible College portal.",
        `Set your password here (the link works once and expires in 7 days):`,
        link,
        "",
        "If you weren't expecting this, you can ignore this email.",
      ].join("\n"),
    });
  }

  async sendPasswordReset(to: Recipient, token: string): Promise<boolean> {
    const link = this.resetLink(token);
    return this.deliver({
      to: to.email,
      subject: "Reset your GLIM Bible College password",
      category: "password-reset",
      text: [
        `Hello ${to.displayName},`,
        "",
        "Someone asked to reset the password for your GLIM Bible College account.",
        `Choose a new password here (the link works once and expires in 30 minutes):`,
        link,
        "",
        "If this wasn't you, ignore this email; your password hasn't changed.",
      ].join("\n"),
    });
  }

  private async deliver(message: Parameters<Mailer["send"]>[0]): Promise<boolean> {
    try {
      await this.mailer.send(message);
      return true;
    } catch (error) {
      this.logger.error({ err: error, category: message.category }, "account email failed");
      return false;
    }
  }
}
