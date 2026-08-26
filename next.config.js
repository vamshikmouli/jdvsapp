/** @type {import('next').NextConfig} */

// Content-Security-Policy tuned to what this app actually loads:
//  - Google Fonts (stylesheet + font files)
//  - Supabase Storage images
//  - Next.js inline hydration scripts (need 'unsafe-inline'; 'unsafe-eval' for dev/React-refresh)
const SUPABASE = process.env.SUPABASE_URL || 'https://ydidwwgvemmbovxeothd.supabase.co';
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  `connect-src 'self' ${SUPABASE}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join('; ');

const securityHeaders = [
  // Force HTTPS for a year (incl. subdomains). Browsers refuse plain http after first visit.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Clickjacking protection (old browsers) — CSP frame-ancestors covers modern ones.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Stop MIME-type sniffing.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Don't leak full URLs to other origins.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Allow only the browser features this app uses; deny the rest.
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), publickey-credentials-get=(self)' },
  { key: 'Content-Security-Policy', value: csp },
];

const nextConfig = {
  reactStrictMode: true,
  // Native/runtime packages Next must NOT try to webpack-bundle:
  //  - pdf-parse pulls in pdfjs worker/sample files (used by /api/marks/upload)
  //  - @napi-rs/canvas ships a .node binary (used by the weekly attendance image)
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'exceljs', '@napi-rs/canvas'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
