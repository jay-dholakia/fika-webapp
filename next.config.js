/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: '/onboarding', destination: '/app/onboarding', permanent: false },
      { source: '/app/weeklyfika', destination: '/app/yourfika', permanent: true },
      { source: '/app/availability', destination: '/app/yourfika', permanent: false },
      { source: '/admin/weekly-sessions', destination: '/admin/fika-socials', permanent: true },
      { source: '/admin/weekly-sessions/:path*', destination: '/admin/fika-socials/:path*', permanent: true },
      { source: '/api/admin/weekly-sessions', destination: '/api/admin/fika-socials', permanent: true },
      { source: '/api/admin/weekly-sessions/:path*', destination: '/api/admin/fika-socials/:path*', permanent: true },
    ]
  },
}

module.exports = nextConfig
