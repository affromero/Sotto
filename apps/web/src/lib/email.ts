import { Resend } from 'resend';
import { logger } from './logger';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export class EmailConfigurationError extends Error {
  readonly missing: string[];

  constructor(message: string, missing: string[]) {
    super(message);
    this.name = 'EmailConfigurationError';
    this.missing = missing;
  }
}

export class EmailDeliveryError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.cause = cause;
  }
}

interface ResendEmailConfig {
  apiKey: string;
  from: string;
}

function getResendApiKey(): string | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  return apiKey || null;
}

function getEmailFrom(): string | null {
  const from = process.env.EMAIL_FROM?.trim();
  return from || null;
}

export function getOptionalEmailProviderConfig(): ResendEmailConfig | null {
  const apiKey = getResendApiKey();
  const from = getEmailFrom();

  if (!apiKey && !from) {
    return null;
  }

  if (!apiKey || !from) {
    const missing = [...(!apiKey ? ['RESEND_API_KEY'] : []), ...(!from ? ['EMAIL_FROM'] : [])];
    throw new EmailConfigurationError(`Email delivery requires ${missing.join(' and ')}`, missing);
  }

  return { apiKey, from };
}

export function assertEmailDeliveryConfigured(): ResendEmailConfig {
  const config = getOptionalEmailProviderConfig();
  if (!config) {
    throw new EmailConfigurationError('Email delivery requires RESEND_API_KEY and EMAIL_FROM', [
      'RESEND_API_KEY',
      'EMAIL_FROM',
    ]);
  }
  return config;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<void> {
  try {
    const config = assertEmailDeliveryConfigured();
    const resend = new Resend(config.apiKey);
    const { data, error } = await resend.emails.send({
      from: config.from,
      to,
      subject,
      html,
    });

    if (error) {
      const message = getErrorMessage(error);
      logger.error('Resend API error', { to, subject, error: message });
      throw new EmailDeliveryError(`Resend API error: ${message}`, error);
    }

    logger.info('Email sent', { to, subject, id: data?.id });
  } catch (error) {
    if (error instanceof EmailConfigurationError) {
      logger.error('Email delivery is not configured', {
        to,
        subject,
        missing: error.missing,
      });
      throw error;
    }
    if (error instanceof EmailDeliveryError) {
      throw error;
    }

    const message = getErrorMessage(error);
    logger.error('Failed to send email', { to, subject, error: message });
    throw new EmailDeliveryError(`Failed to send email: ${message}`, error);
  }
}
