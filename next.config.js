/** @type {import('next').NextConfig} */
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
};

module.exports = nextConfig;
