import path from "node:path";
import type { NextConfig } from "next";

// The legal pages show these, and Razorpay checks them before turning on live payments, so the live site
// is never built without them (see src/config/legal.ts).
const legalEnv = ["NEXT_PUBLIC_LEGAL_NAME", "NEXT_PUBLIC_LEGAL_EMAIL", "NEXT_PUBLIC_LEGAL_PHONE", "NEXT_PUBLIC_LEGAL_ADDRESS"];
const missingLegalEnv = legalEnv.filter((key) => !process.env[key]?.trim());
if (process.env.VERCEL_ENV === "production" && missingLegalEnv.length) {
  throw new Error(`Set ${missingLegalEnv.join(", ")} in the project's environment variables for the legal pages.`);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this folder (there's another lockfile higher up).
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
