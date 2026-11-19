import { config } from './config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends email through Resend when RESEND_API_KEY and MAIL_FROM are set.
 * Otherwise (local development) prints the message to the server console.
 */
export async function sendMail(mail: Mail): Promise<void> {
  const { resendApiKey, from } = config.mail;
  if (resendApiKey && from) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
    });
    if (!res.ok) {
      console.error('Resend error', res.status, await res.text().catch(() => ''));
      throw new Error('Could not send email');
    }
    return;
  }

  if (config.isProduction) {
    // Never fall back to logging codes in production.
    throw new Error('Email is not configured: set RESEND_API_KEY and MAIL_FROM.');
  }
  const line = '─'.repeat(56);
  console.log(`\n${line}\n[dev mailer] To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n${line}\n`);
}
