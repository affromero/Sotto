import { Resend } from 'resend';
import { logger } from './logger';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const DEFAULT_FROM = process.env.EMAIL_FROM || 'Sotto <hello@sotto.fm>';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<boolean> {
  if (!resend) {
    logger.debug('Email not sent — RESEND_API_KEY not configured', { to, subject });
    return false;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: DEFAULT_FROM,
      to,
      subject,
      html,
    });
    if (error) {
      logger.error('Resend API error', { to, subject, error });
      return false;
    }
    logger.info('Email sent', { to, subject, id: data?.id });
    return true;
  } catch (err) {
    logger.error('Failed to send email', {
      to,
      subject,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
