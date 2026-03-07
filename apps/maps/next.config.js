/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@sotto/maps', '@sotto/shared'],
};

module.exports = nextConfig;
