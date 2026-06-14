import type { Surface, Permission } from '@prisma/client';
import type { DefaultSession } from 'next-auth';

/**
 * Module augmentation so the NextAuth session/JWT carry our RBAC fields
 * with real types (no more `(session.user as any).perms`).
 */
declare module 'next-auth' {
  interface Session {
    sessionId?: string;
    user: {
      id: string;
      roleKey: string;
      roleName: string;
      surface: Surface;
      perms: Permission[];
      staffId?: string | null;
      isParent?: boolean;
      sessionId?: string;
    } & DefaultSession['user'];
  }

  interface User {
    roleKey?: string;
    roleName?: string;
    surface?: Surface;
    perms?: Permission[];
    staffId?: string | null;
    isParent?: boolean;
    sessionId?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    roleKey?: string;
    roleName?: string;
    surface?: Surface;
    perms?: Permission[];
    staffId?: string | null;
    isParent?: boolean;
    sessionId?: string;
  }
}
