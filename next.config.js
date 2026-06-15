/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdf-parse pulls in pdfjs at runtime; keep it external so Next doesn't try to
  // bundle its worker/sample files (used by /api/marks/upload).
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'exceljs'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

module.exports = nextConfig;
