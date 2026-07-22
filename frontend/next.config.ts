import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const repoRoot = path.join(__dirname, "..");

/** Load monorepo root `.env` / `.env.local` (local wins). Package-level Next env still applies. */
function loadRepoRootEnv() {
  for (const name of [".env", ".env.local"] as const) {
    const file = path.join(repoRoot, name);
    if (!fs.existsSync(file)) continue;
    const parsed = parseEnv(fs.readFileSync(file, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (name === ".env.local" || process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

loadRepoRootEnv();

// Docker: API_URL=http://api:5002 (compose service). Local: http://localhost:5002
const API_URL = (process.env.API_URL || "http://localhost:5002").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // Monorepo: file tracing / turbopack resolve from repo root
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
  // Slimmer image for Docker (see Dockerfile `frontend` target)
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["pg"],
  // link-me style: browser calls same-origin /api → proxy to Express.
  // App Router filesystem routes (e.g. /api/wallet/*) take precedence over rewrites.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "i.pravatar.cc",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "via.placeholder.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
