/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [{ source: '/onboarding', destination: '/app/onboarding', permanent: false }]
  },
}

module.exports = nextConfig
