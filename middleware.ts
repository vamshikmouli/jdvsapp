import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

// Each /admin route requires a permission (or none = any signed-in staff).
const ADMIN_ROUTE_PERMS: { prefix: string; perm: string }[] = [
  { prefix: '/admin/attendance', perm: 'ATTENDANCE_VIEW' },
  { prefix: '/admin/students', perm: 'STUDENTS_VIEW' },
  { prefix: '/admin/hall-tickets', perm: 'STUDENTS_MANAGE' },
  { prefix: '/admin/classes', perm: 'CLASSES_VIEW' },
  // More-specific prefixes MUST come before '/admin/staff' (first match wins).
  { prefix: '/admin/staff-attendance', perm: 'STAFF_ATTENDANCE_VIEW' },
  { prefix: '/admin/my-attendance', perm: 'STAFF_ATTENDANCE_MARK' },
  { prefix: '/admin/staff', perm: 'STAFF_VIEW' },
  { prefix: '/admin/roles', perm: 'ROLES_MANAGE' },
  { prefix: '/admin/communications', perm: 'NOTICES_MANAGE' },
  { prefix: '/admin/marks', perm: 'MARKS_VIEW' },
  { prefix: '/admin/promotions', perm: 'SETTINGS_MANAGE' },
  // /admin/dashboard and /admin/settings need no specific permission
];

export const middleware = withAuth(
  function middleware(req) {
    const token = req.nextauth.token as any;
    const pathname = req.nextUrl.pathname;

    // Old parent-login path now redirects to the unified login — let it render.
    if (pathname === '/parent/login') return NextResponse.next();

    // A revoked session clears the token's identity fields (see authOptions jwt
    // callback). Treat a token with no surface as logged-out → back to login.
    const surface = token?.surface as string | undefined;
    const perms = (token?.perms as string[]) || [];
    if (!surface) {
      // One login for everyone — staff and parents both sign in at "/".
      return NextResponse.redirect(new URL('/', req.url));
    }

    // Admin shell is for staff. Parents have their own app.
    if (pathname.startsWith('/admin')) {
      if (surface === 'PARENT') {
        return NextResponse.redirect(new URL('/parent', req.url));
      }
      const rule = ADMIN_ROUTE_PERMS.find((r) => pathname.startsWith(r.prefix));
      if (rule && !perms.includes(rule.perm)) {
        return NextResponse.redirect(new URL('/unauthorized', req.url));
      }
    }

    // Retired per-role dashboards → unified admin shell
    if (pathname.startsWith('/teacher') || pathname.startsWith('/accountant')) {
      return NextResponse.redirect(new URL('/admin/dashboard', req.url));
    }

    // Parent app — parents, admins (support), and any staff who are ALSO a
    // guardian of a student (dual staff + parent accounts can switch in).
    if (pathname.startsWith('/parent') && !['PARENT', 'ADMIN'].includes(surface) && !token?.isParent) {
      return NextResponse.redirect(new URL('/unauthorized', req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // Let parent routes through even without a token so the middleware can
      // bounce them to /parent/login (instead of the staff login).
      authorized: ({ token, req }) => req.nextUrl.pathname.startsWith('/parent') || !!token,
    },
    pages: {
      signIn: '/',
    },
  }
);

export const config = {
  matcher: ['/admin/:path*', '/teacher/:path*', '/accountant/:path*', '/parent/:path*'],
};
