import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/Providers';
import { PWARegister } from '@/components/PWARegister';
import { prisma } from '@/lib/db';
import './globals.css';

// Title + favicon follow the school configured in Settings (admin-uploaded logo).
export async function generateMetadata(): Promise<Metadata> {
  let schoolName = 'Jnana Deepika';
  let icon = '/icon.svg';
  try {
    const s = await prisma.settings.findUnique({
      where: { id: 'singleton' },
      select: { schoolName: true, logoUrl: true },
    });
    if (s?.schoolName) schoolName = s.schoolName;
    if (s?.logoUrl) icon = s.logoUrl;
  } catch {
    // DB unavailable (e.g. at build) — fall back to defaults.
  }
  return {
    title: `${schoolName} — School ERP`,
    description: 'School management system for attendance and fee management',
    manifest: '/manifest.webmanifest',
    applicationName: schoolName,
    appleWebApp: { capable: true, statusBarStyle: 'default', title: schoolName },
    icons: { icon, apple: icon },
  };
}

export const viewport: Viewport = {
  themeColor: '#7C3AED',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <PWARegister />
      </body>
    </html>
  );
}
