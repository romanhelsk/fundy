/**
 * Development mailer: prints messages to the server console instead of sending
 * email. Replace `sendMail` with a real provider (SES, Postmark, Resend, ...)
 * before going live.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(mail: Mail): Promise<void> {
  const line = '─'.repeat(56);
  console.log(`\n${line}\n[dev mailer] To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n${line}\n`);
}
