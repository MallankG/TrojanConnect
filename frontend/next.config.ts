import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Vercel Services does not route /_next/image (404), so on Vercel serve /public images as-is.
  images: { unoptimized: !!process.env.VERCEL },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Same-origin deploys (Replit): the browser calls /api/* on this host and Next.js forwards it to the
  // FastAPI backend, which stays private. Locally the app calls http://localhost:8000 directly instead.
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/mock-engagesc/:path*", destination: `${backend}/mock-engagesc/:path*` },
      { source: "/mock-engagesc", destination: `${backend}/mock-engagesc` },
    ];
  },
};

export default nextConfig;
