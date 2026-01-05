import { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    unoptimized: true,
  },
  // Ensure we don't have issues with large bodies if needed
};

export default nextConfig;
