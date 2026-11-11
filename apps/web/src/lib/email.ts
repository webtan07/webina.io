/**
 * Email delivery.
 *
 * Milestone 1 has no email provider yet (that arrives with billing in
 * Milestone 6), so this is a thin, honest seam: when EMAIL_SERVER_URL is unset
 * in development the message is written to the server log instead of being
 * sent, and in production a missing transport is a loud error rather than a
 * silently dropped magic link.
 *
 * The transport is an HTTP endpoint that accepts { to, subject, text } as JSON.
 * That keeps the app free of a mail library until there is a reason to pick one.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const endpoint = process.env.EMAIL_SERVER_URL;
  if (!endpoint) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "email is not configured: set EMAIL_SERVER_URL before relying on email delivery",
      );
    }
    console.info(
      `[webina] email not sent (no EMAIL_SERVER_URL) — to=${message.to} subject=${message.subject}\n${message.text}`,
    );
    return;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.EMAIL_SERVER_TOKEN
        ? { authorization: `Bearer ${process.env.EMAIL_SERVER_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    throw new Error(`email transport rejected the message with status ${response.status}`);
  }
}
