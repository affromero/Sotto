# Authentication Setup

> NextAuth v5 configuration, OAuth provider setup, session strategy, protected routes, and local testing guide.

**Date:** 2026-02-18

---

## Overview

Sotto uses **NextAuth.js v5** (also known as Auth.js) with the Prisma adapter for authentication. Users can sign in with Google, GitHub, Twitter, or Apple. The session strategy is JWT-based for stateless, edge-compatible auth. Protected routes are enforced at the middleware level before any page or API route executes.

| Component        | Technology             | File                                           |
| ---------------- | ---------------------- | ---------------------------------------------- |
| Auth library     | NextAuth.js v5         | `src/lib/auth.ts`                              |
| Database adapter | `@auth/prisma-adapter` | `src/lib/auth.ts`                              |
| Middleware       | Next.js middleware     | `src/middleware.ts`                            |
| Auth API route   | Catch-all handler      | `src/app/api/auth/[...nextauth]/route.ts`      |
| Session provider | React context          | `src/components/providers/SessionProvider.tsx` |

---

## Environment Variables

All auth-related environment variables required for the system to function:

| Variable               | Required         | Description                                       | Example                             |
| ---------------------- | ---------------- | ------------------------------------------------- | ----------------------------------- |
| `AUTH_SECRET`          | Yes              | Encryption key for Auth.js sessions and signed app tokens | `openssl rand -base64 32` output |
| `NEXTAUTH_URL`         | Yes (production) | Canonical URL of the app                          | `https://your-domain.example`                  |
| `GOOGLE_CLIENT_ID`     | No               | Google OAuth client ID                            | `123456.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | No               | Google OAuth client secret                        | `GOCSPX-xxxxxxxxxxxx`               |
| `GOOGLE_IOS_CLIENT_ID` | No               | Google OAuth client ID for iOS app                | `123456.apps.googleusercontent.com` |
| `GITHUB_CLIENT_ID`     | No               | GitHub OAuth app client ID                        | `Iv1.xxxxxxxxxxxx`                  |
| `GITHUB_CLIENT_SECRET` | No               | GitHub OAuth app client secret                    | `xxxxxxxxxxxxxxxxxxxx`              |
| `TWITTER_CLIENT_ID`    | No               | Twitter OAuth 2.0 client ID                       | `xxxxxxxxxxxxxxxxxxxx`              |
| `TWITTER_CLIENT_SECRET`| No               | Twitter OAuth 2.0 client secret                   | `xxxxxxxxxxxxxxxxxxxx`              |
| `APPLE_CLIENT_ID`      | No               | Apple Services ID                                 | `com.sotto.app`                     |
| `APPLE_CLIENT_SECRET`  | No               | Apple client secret (generated JWT)               | `eyJhbGciOi...`                     |

OAuth providers are conditionally loaded. If the environment variables for a provider are not set, that provider is simply not available. The app will still start and function with no OAuth providers configured (useful for local development where you only need to test other features).

### Generating AUTH_SECRET

```bash
openssl rand -base64 32
```

Copy the output into your `.env` file. This secret is used to encrypt JWT tokens and sign cookies. It must be the same across all instances of the app in production.

---

## NextAuth Configuration

The main configuration lives in `src/lib/auth.ts`:

```typescript
import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Twitter from 'next-auth/providers/twitter';
import Apple from 'next-auth/providers/apple';
import { prisma } from './prisma';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  adapter: PrismaAdapter(prisma),
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })]
      : []),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [GitHub({ clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET })]
      : []),
    ...(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET
      ? [Twitter({ clientId: process.env.TWITTER_CLIENT_ID, clientSecret: process.env.TWITTER_CLIENT_SECRET })]
      : []),
    ...(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET
      ? [Apple({ clientId: process.env.APPLE_CLIENT_ID, clientSecret: process.env.APPLE_CLIENT_SECRET })]
      : []),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/auth/login',
    newUser: '/onboarding',
  },
  events: {
    async linkAccount({ user, account, profile }) {
      // Sync Twitter handle when user links their Twitter account
      if (account.provider === 'twitter' && user.id) {
        const twitterHandle = (profile as Record<string, unknown>)?.username as string | undefined;
        await prisma.user.update({
          where: { id: user.id },
          data: { twitterEnabled: true, ...(twitterHandle ? { twitterHandle } : {}) },
        });
      }
    },
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = token.role ?? 'USER';
        session.user.bannedAt = token.bannedAt ?? null;
        session.user.suspendedUntil = token.suspendedUntil ?? null;
      }
      return session;
    },
    async jwt({ token, user, trigger }) {
      if (user) {
        token.sub = user.id;
      }
      // On sign-in or session update, fetch role + ban state from DB
      if ((user || trigger === 'update') && token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { role: true, bannedAt: true, suspendedUntil: true },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.bannedAt = dbUser.bannedAt?.toISOString() ?? null;
          token.suspendedUntil = dbUser.suspendedUntil?.toISOString() ?? null;
        }
      }
      return token;
    },
  },
});
```

### Key Design Decisions

**JWT session strategy:** Sotto uses JWT (`strategy: 'jwt'`) instead of database sessions. This means:

- Sessions are stored in an encrypted cookie, not in the database
- No database lookup on every request
- Works at the edge (Vercel Edge Functions, middleware)
- Session data is available in middleware without a database call
- The `Session` model in Prisma exists for NextAuth adapter compatibility but is not actively used for session storage

**Single auth secret:** `AUTH_SECRET` is the only supported session/signature secret. The `trustHost: true` flag is required for Hetzner VPS deployment (non-Vercel).

**Conditional providers:** Providers are wrapped in conditional spread operators so the app starts even when OAuth credentials are missing. This is critical for local development where you might not have all OAuth apps configured.

**Custom pages:** The `signIn` page is `/auth/login` (not the default NextAuth sign-in page). After a brand-new user signs up, they are redirected to `/onboarding` to select interests and configure their profile.

**User ID + role in session:** The `jwt` callback copies the database user ID, role, ban state, and suspension state into the JWT token. The `session` callback propagates these to `session.user`. This ensures every API route and server component can access the authenticated user's role and moderation status.

**Twitter handle sync:** The `events.linkAccount` hook automatically syncs the user's Twitter handle when they link their Twitter account, enabling the configured bot integration.

---

## Prisma User Model

NextAuth's Prisma adapter requires specific models. These are defined in `prisma/schema.prisma`:

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?
  bio           String?   @db.Text
  emailVerified DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // Role
  role          UserRole @default(USER)

  // Team membership
  teamId String?
  team   Team?   @relation(fields: [teamId], references: [id])

  // NextAuth relations
  accounts  Account[]
  sessions  Session[]

  // App relations
  podcasts      Podcast[]
  discoveries   Discovery[]
  interactions  Interaction[]
  notifications Notification[]
  // ... additional relations
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

The `Account` model stores OAuth provider tokens. A user can have multiple accounts (e.g., both Google and GitHub linked). The `@@unique([provider, providerAccountId])` constraint prevents duplicate OAuth links. The `onDelete: Cascade` on the `user` relation ensures that deleting a user removes all their linked accounts and sessions.

---

## OAuth Provider Setup

### Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth 2.0 Client ID**
5. Configure the OAuth consent screen:
   - App name: `Sotto`
   - User support email: your email
   - Authorized domains: `your-domain.example` (production) or `localhost` (development)
   - Scopes: `email`, `profile`, `openid`
6. Create the OAuth client:
   - Application type: **Web application**
   - Name: `Sotto Web`
   - Authorized JavaScript origins:
     - `http://localhost:3000` (development)
     - `https://your-domain.example` (production)
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google` (development)
     - `https://your-domain.example/api/auth/callback/google` (production)
7. Copy the **Client ID** and **Client Secret** into your `.env` file:

```bash
GOOGLE_CLIENT_ID=123456789.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
```

**Important notes:**

- The redirect URI must match exactly, including protocol and path
- For development, the consent screen can be in "Testing" mode (limited to test users you add)
- For production, you will need to verify the app with Google (takes 1-3 weeks)
- The consent screen shows the app name, icon, and privacy policy URL

### GitHub Developer Settings

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in the application details:
   - Application name: `Sotto`
   - Homepage URL: `http://localhost:3000` (development) or `https://your-domain.example` (production)
   - Authorization callback URL: `http://localhost:3000/api/auth/callback/github` (development) or `https://your-domain.example/api/auth/callback/github` (production)
4. Click **Register application**
5. On the app page, copy the **Client ID**
6. Click **Generate a new client secret** and copy it immediately (shown only once)
7. Add to `.env`:

```bash
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Important notes:**

- GitHub allows only one callback URL per OAuth app. You will need separate OAuth apps for development and production.
- GitHub automatically provides `email` and `profile` scopes.
- Unlike Google, there is no verification process required.

### Twitter Developer Portal

1. Go to [Twitter Developer Portal](https://developer.twitter.com/en/portal/projects-and-apps)
2. Create a new project and app (or use an existing one)
3. Navigate to **User authentication settings** → **Set up**
4. Configure OAuth 2.0:
   - Type of app: **Web App**
   - Callback URI: `http://localhost:3000/api/auth/callback/twitter` (development) or `https://your-domain.example/api/auth/callback/twitter` (production)
   - Website URL: `https://your-domain.example`
5. Copy the **Client ID** and **Client Secret**
6. Add to `.env`:

```bash
TWITTER_CLIENT_ID=xxxxxxxxxxxxxxxxxxxx
TWITTER_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxx
```

**Important notes:**

- Twitter uses OAuth 2.0 with PKCE for NextAuth v5 (not OAuth 1.0a)
- The `events.linkAccount` hook automatically syncs the user's Twitter handle to enable configured bot features
- Users who sign in with Twitter get `twitterEnabled: true` set on their User record

### Apple Sign In

Apple Sign In is more involved than Google or GitHub. It requires an Apple Developer account ($99/year) and several configuration steps.

1. **Apple Developer Account:** Go to [developer.apple.com](https://developer.apple.com/) and enroll in the Apple Developer Program if not already enrolled.

2. **Register an App ID:**
   - Go to **Certificates, Identifiers & Profiles > Identifiers**
   - Click the **+** button, select **App IDs**, then **App**
   - Description: `Sotto`
   - Bundle ID (Explicit): `com.sotto.app`
   - Enable **Sign In with Apple** capability
   - Click **Continue** and **Register**

3. **Create a Services ID:**
   - Go to **Identifiers**, click **+**, select **Services IDs**
   - Description: `Sotto Web`
   - Identifier: `com.sotto.web` (this becomes `APPLE_CLIENT_ID`)
   - Click **Continue** and **Register**
   - Click on the newly created Services ID
   - Enable **Sign In with Apple**
   - Click **Configure** next to Sign In with Apple:
     - Primary App ID: select `com.sotto.app`
     - Domains: `your-domain.example` (production), `localhost` (development)
     - Return URLs: `https://your-domain.example/api/auth/callback/apple`
   - Click **Save**, then **Continue**, then **Save**

4. **Create a Key for Sign In with Apple:**
   - Go to **Keys**, click **+**
   - Key Name: `Sotto Auth Key`
   - Enable **Sign In with Apple**, click **Configure**, select `com.sotto.app`
   - Click **Continue**, then **Register**
   - Download the `.p8` key file (shown only once)
   - Note the **Key ID** shown on the confirmation page

5. **Generate the Client Secret:**
   Apple does not provide a static client secret. You must generate a JWT signed with the `.p8` key. This JWT expires every 6 months and must be regenerated.

   ```javascript
   // scripts/generate-apple-secret.js
   const jwt = require('jsonwebtoken');
   const fs = require('fs');

   const privateKey = fs.readFileSync('AuthKey_XXXXXXXXXX.p8');
   const teamId = 'YOUR_TEAM_ID'; // From Apple Developer account
   const clientId = 'com.sotto.web'; // Services ID identifier
   const keyId = 'XXXXXXXXXX'; // Key ID from step 4

   const token = jwt.sign({}, privateKey, {
     algorithm: 'ES256',
     expiresIn: '180d',
     audience: 'https://appleid.apple.com',
     issuer: teamId,
     subject: clientId,
     keyid: keyId,
   });

   console.log(token);
   ```

6. **Add the Apple provider to `auth.ts`:**

   ```typescript
   import Apple from 'next-auth/providers/apple';

   // Inside the providers array:
   ...(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET
     ? [
         Apple({
           clientId: process.env.APPLE_CLIENT_ID,
           clientSecret: process.env.APPLE_CLIENT_SECRET,
         }),
       ]
     : []),
   ```

7. **Add to `.env`:**

   ```bash
   APPLE_CLIENT_ID=com.sotto.web
   APPLE_CLIENT_SECRET=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ilh... # Generated JWT
   ```

**Important notes:**

- The client secret JWT expires every 6 months. Set a calendar reminder to regenerate it.
- Apple Sign In on web uses a redirect flow. On native iOS (React Native, future), it uses the native Apple Sign In SDK.
- Apple may only provide the user's name on the first sign-in. Store it immediately because subsequent sign-ins will not include it.
- Apple allows users to hide their real email, providing a relay address (`xxxxx@privaterelay.appleid.com`). Your app must handle this.

---

## Auth API Route

The catch-all auth route at `src/app/api/auth/[...nextauth]/route.ts` is minimal:

```typescript
import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;
```

NextAuth v5 exports `handlers` from the main config. This route handles all auth flows including:

- `/api/auth/signin` — Sign in page redirect
- `/api/auth/callback/google` — Google OAuth callback
- `/api/auth/callback/github` — GitHub OAuth callback
- `/api/auth/callback/twitter` — Twitter OAuth callback
- `/api/auth/callback/apple` — Apple OAuth callback
- `/api/auth/signout` — Sign out
- `/api/auth/session` — Current session data (JSON)
- `/api/auth/csrf` — CSRF token
- `/api/auth/providers` — Available providers list

---

## Protected Routes via Middleware

Route protection is handled in `src/middleware.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const PROTECTED_ROUTES = ['/dashboard', '/create', '/settings'];
const AUTH_ROUTES = ['/auth/login', '/auth/signup'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = await getToken({ req: request });

  // Skip API routes (handled by individual route handlers)
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Skip static files and webhooks
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/fonts')
  ) {
    return NextResponse.next();
  }

  // Redirect authenticated users away from auth pages
  if (token && AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Redirect unauthenticated users to login for protected routes
  if (!token && PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts|manifest.json|sw.js).*)'],
};
```

### Route Protection Summary

| Route Pattern   | Auth Required              | Behavior                                                            |
| --------------- | -------------------------- | ------------------------------------------------------------------- |
| `/dashboard`    | Yes                        | Redirect to `/auth/login?callbackUrl=/dashboard`                    |
| `/create`       | Yes                        | Redirect to `/auth/login?callbackUrl=/create`                       |
| `/settings`     | Yes                        | Redirect to `/auth/login?callbackUrl=/settings`                     |
| `/auth/login`   | No (redirect if logged in) | Redirect to `/dashboard` if already authenticated                   |
| `/auth/signup`  | No (redirect if logged in) | Redirect to `/dashboard` if already authenticated                   |
| `/podcast/[id]` | Depends on visibility      | Public podcasts: no auth. Private/unlisted: checked in the page/API |
| `/api/*`        | Varies                     | Auth checked per-route in the API handler                           |

### API Route Auth Pattern

API routes are not protected by middleware (they return early with `NextResponse.next()`). Instead, each API route checks auth individually using `auth()`:

```typescript
import { auth } from '@/lib/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  // ... proceed with authenticated request
}
```

This pattern allows fine-grained control: public informational routes can stay unauthenticated, while private workspace routes such as `/api/podcasts` POST require authentication.

### Callback URL Preservation

When an unauthenticated user tries to access a protected route, the middleware appends a `callbackUrl` query parameter to the login URL. After successful authentication, NextAuth redirects the user back to their originally intended destination. For example:

1. User navigates to `/create`
2. Middleware redirects to `/auth/login?callbackUrl=/create`
3. User signs in with Google
4. NextAuth redirects to `/create`

---

## Session Provider

Client components need access to the session. The `SessionProvider` wraps the app in the root layout:

```typescript
// apps/web/src/components/providers/SessionProvider.tsx
'use client';

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';

interface SessionProviderProps {
  children: React.ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}
```

Used in `src/app/layout.tsx`:

```typescript
import { SessionProvider } from '@/components/providers/SessionProvider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
```

Client components access the session via the `useSession` hook:

```typescript
'use client';
import { useSession, signIn, signOut } from 'next-auth/react';

function ProfileMenu() {
  const { data: session, status } = useSession();

  if (status === 'loading') return <Spinner />;
  if (!session) return <Button onClick={() => signIn()}>Sign In</Button>;

  return (
    <div>
      <span>{session.user.name}</span>
      <Button onClick={() => signOut()}>Sign Out</Button>
    </div>
  );
}
```

---

## Testing Auth Locally

### Without OAuth Providers

For local development where you do not have Google or GitHub OAuth apps configured:

1. The app starts without errors (providers are conditionally loaded)
2. The login page renders but shows no OAuth buttons
3. You can test non-auth features such as public informational pages
4. To test authenticated features, set up at least one OAuth provider

### With Google OAuth (Recommended for Local Dev)

1. Create a Google Cloud project and OAuth client as described above
2. Use `http://localhost:3000` as the JavaScript origin
3. Use `http://localhost:3000/api/auth/callback/google` as the redirect URI
4. Add your Google account as a test user in the consent screen (while in testing mode)
5. Set the environment variables:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
AUTH_SECRET=any-random-string-for-local-dev
NEXTAUTH_URL=http://localhost:3000
```

6. Start the app with `npm run dev:web`
7. Navigate to `http://localhost:3000/auth/login`
8. Click "Sign in with Google"
9. Complete the OAuth flow
10. You should be redirected to `/onboarding` (as a new user) or `/dashboard` (returning user)

### With GitHub OAuth

1. Create a GitHub OAuth app as described above
2. Use `http://localhost:3000` as the homepage URL
3. Use `http://localhost:3000/api/auth/callback/github` as the callback URL
4. Set the environment variables:

```bash
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
```

### Verifying Auth Works

After signing in, verify the following:

| Check                 | How                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| Session exists        | Visit `http://localhost:3000/api/auth/session` in browser — should return JSON with user data          |
| User created in DB    | Open Prisma Studio (`npx prisma studio`) and check the `User` table                                    |
| Account linked        | Check the `Account` table in Prisma Studio for the OAuth provider record                               |
| Protected routes work | Navigate to `/dashboard` — should load (not redirect to login)                                         |
| Auth redirect works   | Open an incognito window, navigate to `/create` — should redirect to `/auth/login?callbackUrl=/create` |
| Callback URL works    | After signing in from the redirect, you should land on `/create`                                       |

### Inspecting JWT Tokens

To debug JWT token contents during development:

```typescript
import { getToken } from 'next-auth/jwt';

// In any API route:
export async function GET(request: NextRequest) {
  const token = await getToken({ req: request });
  console.log('JWT token:', token);
  // token.sub = user ID
  // token.email = user email
  // token.name = user name
  // token.picture = avatar URL
}
```

### Common Issues

| Issue                           | Cause                                            | Solution                                                                                |
| ------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| "CSRF token mismatch"           | Missing or wrong `AUTH_SECRET`                   | Ensure `AUTH_SECRET` is set and consistent                                              |
| "OAuth redirect_uri mismatch"   | Callback URL in provider settings does not match | Verify the redirect URI is exactly `http://localhost:3000/api/auth/callback/{provider}` |
| "Access denied" on Google       | Account not added as test user                   | Add your Google account in OAuth consent screen > Test users                            |
| Session is `null` in API routes | Using wrong import                               | Use `import { auth } from '@/lib/auth'`, not from `next-auth` directly                  |
| User ID not in session          | Callbacks not configured                         | Ensure the `jwt` and `session` callbacks are in the NextAuth config                     |
| Cookie not set                  | Wrong `NEXTAUTH_URL`                             | Set `NEXTAUTH_URL=http://localhost:3000` for local dev                                  |

---

## Production Deployment

Sotto is deployed on a Hetzner VPS with Docker Compose + Caddy reverse proxy:

1. Set all environment variables in the production `.env` file on the VPS:
   - `AUTH_SECRET` (generate a strong random string — primary secret)
   - `NEXTAUTH_URL` = `https://your-domain.example`
   - All OAuth provider credentials with production redirect URIs
2. The `trustHost: true` flag in the NextAuth config is required for non-Vercel deployments (Caddy proxies HTTPS)
3. Update all OAuth provider callback URIs to use `https://your-domain.example/api/auth/callback/{provider}`
4. For Google: submit the app for verification to remove the "unverified app" warning
5. For Apple: ensure the Services ID is configured with the production domain

### Security Considerations

- `AUTH_SECRET` must be at least 32 characters and cryptographically random
- Never commit `.env` files to version control
- Rotate the Apple client secret before it expires (every 6 months)
- Use `Secure` cookies in production (handled automatically by NextAuth when `NEXTAUTH_URL` uses `https://`)
- The `sameSite` attribute on cookies is set to `lax` by default, which protects against CSRF in most scenarios
- All OAuth tokens stored in the `Account` table are encrypted at rest by the database

---

## Mobile Auth (iOS)

The React Native iOS app (`apps/mobile/`) authenticates against the same NextAuth backend.

### Environment Variables

| Variable               | Description                                  |
| ---------------------- | -------------------------------------------- |
| `GOOGLE_IOS_CLIENT_ID` | Google OAuth client ID for iOS (different from web) |

### Authentication Flow

1. User taps "Sign in with Google/Apple/GitHub/Twitter" in the mobile app
2. `expo-auth-session` opens the OAuth flow in a system browser
3. On callback, the mobile app receives the auth token
4. Token is stored securely via `expo-secure-store`
5. All subsequent API calls include the token in the `Authorization` header

### Social Login Providers

- **Google Sign-In**: `expo-auth-session` with `GOOGLE_IOS_CLIENT_ID` (separate iOS client in Google Cloud Console)
- **Apple Sign-In**: `expo-apple-authentication` (native SDK, required for App Store)
- **GitHub**: Same OAuth flow as web via `expo-auth-session`
- **Twitter**: Same OAuth 2.0 flow via `expo-auth-session`
