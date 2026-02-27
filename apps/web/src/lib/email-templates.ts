import crypto from 'crypto';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://sotto.fm';

export function generateUserUnsubscribeUrl(userId: string): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || '';
  const signature = crypto.createHmac('sha256', secret).update(userId).digest('hex');
  return `${APP_URL}/api/users/unsubscribe?userId=${encodeURIComponent(userId)}&sig=${signature}`;
}

export function buildAnnouncementEmail(
  subject: string,
  body: string,
  unsubscribeUrl: string
): { subject: string; html: string } {
  const announcementFooter = `
      <div style="padding:24px 32px; border-top:1px solid #f3f4f6; text-align:center;">
        <p style="font-size:12px; color:#9ca3af; margin:0;">
          <a href="${unsubscribeUrl}" style="color:#9ca3af; text-decoration:underline;">Unsubscribe from announcements</a>
          &nbsp;·&nbsp;
          <a href="${APP_URL}" style="color:#9ca3af; text-decoration:underline;">sotto.fm</a>
        </p>
      </div>
    </div>
  </div>
  `;

  return {
    subject,
    html: `${HEADER}
      <div style="padding:16px 32px 32px;">
        <p style="font-size:15px; line-height:1.7; color:#1A1A1A; margin:0;">
          ${body.replace(/\n/g, '<br />')}
        </p>
      </div>
    ${announcementFooter}`,
  };
}

function generateUnsubscribeUrl(email: string): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || '';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(email)
    .digest('hex');
  return `${APP_URL}/api/waitlist/unsubscribe?email=${encodeURIComponent(email)}&sig=${signature}`;
}

const HEADER = `
  <div style="background-color:#FEFCF8; padding:40px 20px; font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;">
    <div style="max-width:560px; margin:0 auto; background:#fff; border-radius:12px; border:1px solid #e5e7eb; overflow:hidden;">
      <div style="padding:32px 32px 0;">
        <h1 style="font-family:'DM Serif Display',Georgia,serif; font-size:24px; color:#1A1A1A; margin:0 0 4px;">
          <span style="color:#D97706;">Sotto</span>
        </h1>
      </div>
`;

function footer(email: string): string {
  const unsubUrl = generateUnsubscribeUrl(email);
  return `
      <div style="padding:24px 32px; border-top:1px solid #f3f4f6; text-align:center;">
        <p style="font-size:12px; color:#9ca3af; margin:0;">
          <a href="${unsubUrl}" style="color:#9ca3af; text-decoration:underline;">Unsubscribe</a>
          &nbsp;·&nbsp;
          <a href="${APP_URL}" style="color:#9ca3af; text-decoration:underline;">sotto.fm</a>
        </p>
      </div>
    </div>
  </div>
  `;
}

export function buildWaitlistWelcomeEmail(email: string): { subject: string; html: string } {
  return {
    subject: 'Welcome to Sotto — you\'re on the list',
    html: `${HEADER}
      <div style="padding:16px 32px 32px;">
        <h2 style="font-family:'DM Serif Display',Georgia,serif; font-size:20px; color:#1A1A1A; margin:0 0 12px;">
          You&apos;re in.
        </h2>
        <p style="font-size:14px; line-height:1.7; color:#6B7280; margin:0 0 16px;">
          Thanks for joining the Sotto waitlist. We&apos;re building the social podcast network
          &mdash; AI or human, create, discover, interrupt, fork, and remix.
        </p>
        <p style="font-size:14px; line-height:1.7; color:#6B7280; margin:0 0 24px;">
          We&apos;ll send you updates as we launch new features. In the meantime, check out
          what&apos;s already live.
        </p>
        <a href="${APP_URL}/feed" style="display:inline-block; background:#D97706; color:#fff; font-size:14px; font-weight:600; padding:10px 24px; border-radius:8px; text-decoration:none;">
          Explore Sotto
        </a>
      </div>
    ${footer(email)}`,
  };
}

export function buildMagicLinkEmail(url: string): { subject: string; html: string } {
  return {
    subject: 'Sign in to Sotto',
    html: `${HEADER}
      <div style="padding:16px 32px 32px;">
        <h2 style="font-family:'DM Serif Display',Georgia,serif; font-size:20px; color:#1A1A1A; margin:0 0 12px;">
          Sign in to Sotto
        </h2>
        <p style="font-size:14px; line-height:1.7; color:#6B7280; margin:0 0 24px;">
          Click the button below to sign in. This link expires in 24 hours.
        </p>
        <a href="${url}" style="display:inline-block; background:#D97706; color:#fff; font-size:14px; font-weight:600; padding:12px 28px; border-radius:8px; text-decoration:none;">
          Sign In
        </a>
        <p style="font-size:12px; line-height:1.5; color:#9ca3af; margin:24px 0 0;">
          If you didn&apos;t request this email, you can safely ignore it.
        </p>
      </div>
      <div style="padding:24px 32px; border-top:1px solid #f3f4f6; text-align:center;">
        <p style="font-size:12px; color:#9ca3af; margin:0;">
          <a href="${APP_URL}" style="color:#9ca3af; text-decoration:underline;">sotto.fm</a>
        </p>
      </div>
    </div>
  </div>`,
  };
}

export function buildWaitlistApprovalEmail(email: string): { subject: string; html: string } {
  return {
    subject: 'Your early access to Sotto is ready',
    html: `${HEADER}
      <div style="padding:16px 32px 32px;">
        <h2 style="font-family:'DM Serif Display',Georgia,serif; font-size:20px; color:#1A1A1A; margin:0 0 12px;">
          You&apos;ve been selected
        </h2>
        <p style="font-size:14px; line-height:1.7; color:#6B7280; margin:0 0 16px;">
          We&apos;re opening Sotto to a small group of early members, and you made the cut.
          Your account is ready &mdash; claim it before your invitation expires.
        </p>
        <a href="${APP_URL}/auth/signup" style="display:inline-block; background:#D97706; color:#fff; font-size:14px; font-weight:600; padding:12px 28px; border-radius:8px; text-decoration:none; margin:0 0 24px;">
          Claim Your Spot
        </a>
        <div style="background:#FEFCF8; border:1px solid #f3f4f6; border-radius:8px; padding:16px; margin-top:24px;">
          <p style="font-size:13px; line-height:1.6; color:#6B7280; margin:0 0 8px;">
            <strong style="color:#1A1A1A;">Quick tip:</strong> Tag
            <a href="https://x.com/sottofm" style="color:#D97706; text-decoration:none; font-weight:600;">@sottofm</a>
            on X with any topic and our bot will turn it into a podcast for you.
          </p>
          <p style="font-size:12px; line-height:1.5; color:#9ca3af; margin:0 0 8px;">
            Try it: <em>&ldquo;@sottofm explain how black holes emit radiation&rdquo;</em>
          </p>
          <p style="font-size:12px; line-height:1.5; color:#9ca3af; margin:0;">
            Just <a href="${APP_URL}/settings" style="color:#D97706; text-decoration:none;">link your X account</a> in settings after signing up.
          </p>
        </div>
      </div>
    ${footer(email)}`,
  };
}

export function buildWelcomeEmail(name: string): { subject: string; html: string } {
  const simpleFooter = `
      <div style="padding:24px 32px; border-top:1px solid #f3f4f6; text-align:center;">
        <p style="font-size:12px; color:#9ca3af; margin:0;">
          <a href="${APP_URL}" style="color:#9ca3af; text-decoration:underline;">sotto.fm</a>
        </p>
      </div>
    </div>
  </div>
  `;

  return {
    subject: 'Welcome to Sotto',
    html: `${HEADER}
      <div style="padding:16px 32px 32px;">
        <h2 style="font-family:'DM Serif Display',Georgia,serif; font-size:20px; color:#1A1A1A; margin:0 0 12px;">
          Welcome, ${name}!
        </h2>
        <p style="font-size:14px; line-height:1.7; color:#6B7280; margin:0 0 16px;">
          You&apos;re all set. Sotto is where podcasts get social &mdash; AI or human,
          create, discover, interrupt, fork, and remix.
        </p>
        <p style="font-size:14px; line-height:1.7; color:#6B7280; margin:0 0 24px;">
          Create your first podcast in minutes &mdash; just describe what you want to learn
          and we&apos;ll handle the rest.
        </p>
        <a href="${APP_URL}/create" style="display:inline-block; background:#D97706; color:#fff; font-size:14px; font-weight:600; padding:10px 24px; border-radius:8px; text-decoration:none;">
          Create Your First Podcast
        </a>
      </div>
    ${simpleFooter}`,
  };
}

interface DigestPodcast {
  id: string;
  title: string;
  topic: string | null;
  slug?: string | null;
  creatorHandle?: string | null;
  creatorName: string | null;
}

export function buildWeeklyDigestEmail(
  email: string,
  podcasts: DigestPodcast[]
): { subject: string; html: string } {
  const podcastRows = podcasts
    .map(
      (p) => `
      <tr>
        <td style="padding:12px 0; border-bottom:1px solid #f3f4f6;">
          <a href="${APP_URL}${p.slug && p.creatorHandle ? `/@${p.creatorHandle}/${p.slug}` : `/podcast/${p.id}`}?utm_source=digest&utm_medium=email&utm_campaign=weekly" style="font-size:14px; font-weight:600; color:#1A1A1A; text-decoration:none;">
            ${p.title}
          </a>
          <p style="font-size:12px; color:#6B7280; margin:4px 0 0;">
            by ${p.creatorName || 'Anonymous'}${p.topic ? ` · ${p.topic.substring(0, 80)}${p.topic.length > 80 ? '...' : ''}` : ''}
          </p>
        </td>
      </tr>`
    )
    .join('');

  return {
    subject: 'This week on Sotto — top podcasts',
    html: `${HEADER}
      <div style="padding:16px 32px 32px;">
        <h2 style="font-family:'DM Serif Display',Georgia,serif; font-size:20px; color:#1A1A1A; margin:0 0 12px;">
          This week on Sotto
        </h2>
        <p style="font-size:14px; line-height:1.7; color:#6B7280; margin:0 0 16px;">
          Here are the most popular podcasts from the last 7 days.
        </p>
        <table style="width:100%; border-collapse:collapse;">
          <tbody>
            ${podcastRows}
          </tbody>
        </table>
        <div style="margin-top:24px;">
          <a href="${APP_URL}/feed?utm_source=digest&utm_medium=email&utm_campaign=weekly" style="display:inline-block; background:#D97706; color:#fff; font-size:14px; font-weight:600; padding:10px 24px; border-radius:8px; text-decoration:none;">
            Browse All
          </a>
        </div>
      </div>
    ${footer(email)}`,
  };
}
