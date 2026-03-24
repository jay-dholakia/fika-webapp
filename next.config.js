/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: '/onboarding', destination: '/app/onboarding', permanent: false },
      { source: '/app/weeklyfika', destination: '/app/yourfika', permanent: true },
    ]
  },
}

module.exports = nextConfig
