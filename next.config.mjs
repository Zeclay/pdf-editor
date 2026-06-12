/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfjs-dist (used by react-pdf) optionally requires the node "canvas"
  // package during SSR bundling. We render client-side only, so stub it out.
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
