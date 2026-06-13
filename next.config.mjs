/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy.
 *
 * Notes on each directive:
 *   script-src  'unsafe-inline' — required by Next.js App Router (inline
 *               hydration bootstrap). For a stricter policy, implement
 *               nonce-based CSP via Next.js middleware instead.
 *   script-src  'unsafe-eval' (dev only) — webpack HMR and React Fast Refresh
 *               use eval() during development. Never included in production.
 *   script-src  blob: — pdfjs-dist spins up its worker as a Blob URL.
 *   worker-src  blob: — same reason.
 *   img-src     data: blob: — signature PNG data-URLs + react-pdf page blobs.
 *   style-src   'unsafe-inline' — Tailwind utility classes generate inline styles.
 *   frame-ancestors 'none' — prevents clickjacking (replaces X-Frame-Options).
 */
const ContentSecurityPolicy = `
  default-src 'self';
  script-src  'self' 'unsafe-inline' ${isDev ? "'unsafe-eval'" : ""} blob:;
  style-src   'self' 'unsafe-inline';
  img-src     'self' data: blob:;
  font-src    'self';
  worker-src  'self' blob:;
  connect-src 'self';
  object-src  'none';
  base-uri    'self';
  frame-ancestors 'none';
`
  .replace(/\s{2,}/g, " ")
  .trim();

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: ContentSecurityPolicy,
  },
  {
    // Belt-and-suspenders clickjacking protection for older browsers that
    // don't understand frame-ancestors in CSP.
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    // Prevent browsers from MIME-sniffing the content type of responses.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Don't send the full referrer URL to third-party sites.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // Deny access to sensitive device APIs this app has no need for.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    // Force HTTPS for 1 year once served over TLS (ignored on plain HTTP).
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig = {
  // pdfjs-dist (used by react-pdf) optionally requires the node "canvas"
  // package during SSR bundling. We render client-side only, so stub it out.
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },

  async headers() {
    return [
      {
        // Apply to every route.
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
