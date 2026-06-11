import crypto from 'crypto';
import { BRAND } from '@sotto/shared';
import { getAppBaseUrl } from './urls';

function appLinkLabel(appUrl: string): string {
  return new URL(appUrl).host;
}

function requireAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is required to sign unsubscribe URLs');
  }
  return secret;
}

export function generateUserUnsubscribeUrl(userId: string, appUrl = getAppBaseUrl()): string {
  const secret = requireAuthSecret();
  const signature = crypto.createHmac('sha256', secret).update(userId).digest('hex');
  return `${appUrl}/api/v1/users/unsubscribe?userId=${encodeURIComponent(userId)}&sig=${signature}`;
}

const HEADER = `
  <div style="background-color:#F5F4F0; padding:40px 20px; font-family:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,sans-serif;">
    <div style="max-width:560px; margin:0 auto; background:#fff; border-radius:12px; border:1px solid #e5e7eb; overflow:hidden;">
      <div style="padding:32px 32px 0;">
        <h1 style="font-family:'Newsreader',Georgia,serif; font-size:24px; color:#1E2128; margin:0 0 4px;">
          <span style="color:#3F4FB0;">Sotto</span>
        </h1>
  </div>
`;

export function buildMagicLinkEmail(url: string): { subject: string; html: string } {
  const appUrl = getAppBaseUrl();
  return {
    subject: 'Sign in to Sotto',
    html: `${HEADER}
      <div style="padding:16px 32px 32px;">
        <h2 style="font-family:'Newsreader',Georgia,serif; font-size:20px; color:#1E2128; margin:0 0 12px;">
          Sign in to Sotto
        </h2>
        <p style="font-size:14px; line-height:1.7; color:#6B7280; margin:0 0 24px;">
          Click the button below to sign in. This link expires in 24 hours.
        </p>
        <a href="${url}" style="display:inline-block; background:#3F4FB0; color:#fff; font-size:14px; font-weight:600; padding:12px 28px; border-radius:8px; text-decoration:none;">
          Sign In
        </a>
        <p style="font-size:12px; line-height:1.5; color:#9ca3af; margin:24px 0 0;">
          If you didn&apos;t request this email, you can safely ignore it.
        </p>
      </div>
      <div style="padding:24px 32px; border-top:1px solid #f3f4f6; text-align:center;">
        <p style="font-size:12px; color:#9ca3af; margin:0;">
          <a href="${appUrl}" style="color:#9ca3af; text-decoration:underline;">${appLinkLabel(appUrl)}</a>
        </p>
      </div>
    </div>
  </div>`,
  };
}

export function buildWelcomeEmail(name: string): { subject: string; html: string } {
  const appUrl = getAppBaseUrl();
  const simpleFooter = `
      <div style="padding:24px 32px; border-top:1px solid #f3f4f6; text-align:center;">
        <p style="font-size:12px; color:#9ca3af; margin:0;">
          <a href="${appUrl}" style="color:#9ca3af; text-decoration:underline;">${appLinkLabel(appUrl)}</a>
        </p>
      </div>
    </div>
  </div>
  `;

  return {
    subject: 'Welcome to Sotto',
    html: `${HEADER}
      <div style="padding:16px 32px 32px;">
        <h2 style="font-family:'Newsreader',Georgia,serif; font-size:20px; color:#1E2128; margin:0 0 12px;">
          Welcome, ${name}!
        </h2>
        <p style="font-size:14px; line-height:1.7; color:#6B7280; margin:0 0 16px;">
          You&apos;re all set. ${BRAND.tagline}
          ${BRAND.subline}
        </p>
        <p style="font-size:14px; line-height:1.7; color:#6B7280; margin:0 0 24px;">
          Create your first podcast in minutes &mdash; just describe what you want to learn
          and we&apos;ll handle the rest.
        </p>
        <a href="${appUrl}/create" style="display:inline-block; background:#3F4FB0; color:#fff; font-size:14px; font-weight:600; padding:10px 24px; border-radius:8px; text-decoration:none;">
          Create Your First Podcast
        </a>
      </div>
    ${simpleFooter}`,
  };
}
