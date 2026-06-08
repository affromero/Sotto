import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockResendSend, mockResendConstructor } = vi.hoisted(() => {
  const send = vi.fn();
  return {
    mockResendSend: send,
    mockResendConstructor: vi.fn(function ResendMock() {
      return { emails: { send } };
    }),
  };
});

vi.mock('resend', () => ({ Resend: mockResendConstructor }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  EmailConfigurationError,
  EmailDeliveryError,
  assertEmailDeliveryConfigured,
  getOptionalEmailProviderConfig,
  sendEmail,
} from '@/lib/email';

describe('email delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('treats email as unconfigured when all Resend settings are absent', () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('EMAIL_FROM', '');

    expect(getOptionalEmailProviderConfig()).toBeNull();
    expect(() => assertEmailDeliveryConfigured()).toThrow(EmailConfigurationError);
  });

  it('requires EMAIL_FROM when RESEND_API_KEY is configured', () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', '');

    expect(() => getOptionalEmailProviderConfig()).toThrow(EmailConfigurationError);
    expect(() => assertEmailDeliveryConfigured()).toThrow(/EMAIL_FROM/);
  });

  it('requires RESEND_API_KEY when EMAIL_FROM is configured', () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('EMAIL_FROM', 'Sotto <noreply@example.com>');

    expect(() => getOptionalEmailProviderConfig()).toThrow(EmailConfigurationError);
    expect(() => assertEmailDeliveryConfigured()).toThrow(/RESEND_API_KEY/);
  });

  it('sends through Resend with explicit config', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', 'Sotto <noreply@example.com>');
    mockResendSend.mockResolvedValue({ data: { id: 'email-1' }, error: null });

    await sendEmail({
      to: 'user@example.com',
      subject: 'Welcome',
      html: '<p>Hello</p>',
    });

    expect(mockResendConstructor).toHaveBeenCalledWith('re_test');
    expect(mockResendSend).toHaveBeenCalledWith({
      from: 'Sotto <noreply@example.com>',
      to: 'user@example.com',
      subject: 'Welcome',
      html: '<p>Hello</p>',
    });
  });

  it('throws delivery errors returned by Resend', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', 'Sotto <noreply@example.com>');
    mockResendSend.mockResolvedValue({
      data: null,
      error: { message: 'Domain is not verified' },
    });

    await expect(
      sendEmail({ to: 'user@example.com', subject: 'Welcome', html: '<p>Hello</p>' })
    ).rejects.toThrow(EmailDeliveryError);
  });

  it('throws delivery errors raised by the transport', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', 'Sotto <noreply@example.com>');
    mockResendSend.mockRejectedValue(new Error('network down'));

    await expect(
      sendEmail({ to: 'user@example.com', subject: 'Welcome', html: '<p>Hello</p>' })
    ).rejects.toThrow(/network down/);
  });
});
