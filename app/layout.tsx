import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/Providers';
import { PWARegister } from '@/components/PWARegister';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jnana Deepika — School ERP',
  description: 'School management system for attendance and fee management',
  manifest: '/manifest.webmanifest',
  applicationName: 'Jnana Deepika',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Jnana Deepika',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
};

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
