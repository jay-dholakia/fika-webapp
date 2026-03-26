/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: '/onboarding', destination: '/app/onboarding', permanent: false },
      { source: '/app/weeklyfika', destination: '/app/yourfika', permanent: true },
      { source: '/app/availability', destination: '/app/yourfika', permanent: false },
    ]
  },
}

module.exports = nextConfig
