'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';

const TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  attendance: 'Attendance',
  students: 'Students',
  'hall-tickets': 'Hall tickets',
  classes: 'Classes',
  staff: 'Staff',
  fees: 'Fees',
  marks: 'Marks',
  communications: 'Communications',
  promotions: 'Promotions',
  roles: 'Roles & access',
  settings: 'Settings',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = React.useState(false);

  // Close the mobile drawer whenever the route changes
  React.useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Derive the page title from the route segment, e.g. /admin/students -> "Students"
  const segment = pathname.split('/')[2] || 'dashboard';
  const title = TITLES[segment] || 'Dashboard';

  // Kiosk runs full-screen with no sidebar/top bar — it's a locked single-purpose screen.
  if (pathname.startsWith('/admin/kiosk')) {
    return <div className="min-h-screen bg-slate-50">{children}</div>;
  }

  return (
    <div className="h-screen bg-slate-25">
      {/* Sidebar (off-canvas drawer on mobile, fixed on desktop) */}
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Main Content */}
      <div className="flex flex-col h-full lg:ml-60">
        <TopBar title={title} onMenu={() => setNavOpen(true)} />

        <main className="flex-1 overflow-y-auto overflow-x-hidden pt-20 pb-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
