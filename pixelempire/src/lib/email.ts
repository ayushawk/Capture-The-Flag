import { env } from "./env";
import { logger } from "./logger";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Minimal mailer. `console` (the default) prints the message and is what local
 * development uses — the magic link appears in the server log. `resend` posts
 * to the Resend HTTP API; no SDK dependency is needed for a single endpoint.
 */
export const sendEmail = async (message: OutboundEmail): Promise<void> => {
  const provider = env.emailProvider;

  if (provider === "console") {
    logger.info("email.console", { to: message.to, subject: message.subject });
    console.log(`\n--- email to ${message.to} ---\n${message.text}\n--- end ---\n`);
    return;
  }

  if (provider === "resend") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      logger.error("email.send_failed", { provider, status: response.status, detail: detail.slice(0, 300) });
      throw new Error("Could not send email");
    }
    logger.info("email.sent", { provider, to: message.to });
    return;
  }

  throw new Error(`Unknown EMAIL_PROVIDER: ${provider}`);
};
