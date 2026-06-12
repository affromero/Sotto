import type { UserRole } from '@/generated/prisma/client';
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: UserRole;
      isImpersonating?: boolean;
      impersonatedRole?: UserRole;
      originalUser?: { id: string; name: string | null; image: string | null };
    };
  }

  interface User {
    role?: UserRole;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: UserRole;
    /** Local (Credentials) session, subject to tokenVersion invalidation. */
    local?: boolean;
    tokenVersion?: number;
    impersonateUserId?: string;
    impersonateName?: string | null;
    impersonateEmail?: string | null;
    impersonateImage?: string | null;
    impersonateRole?: UserRole;
    originalUserId?: string;
    originalUserName?: string | null;
    originalUserImage?: string | null;
  }
}

declare module 'next-auth/react' {
  interface UpdateSession {
    impersonateUserId?: string;
    stopImpersonating?: boolean;
  }
}
