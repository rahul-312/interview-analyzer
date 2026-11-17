import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

// The legal pages show these, and Razorpay checks them before turning on live payments, so no production
// build, on any host, goes out without them (see src/config/legal.ts). Next loads .env files before this.
const legalEnv = ["NEXT_PUBLIC_LEGAL_NAME", "NEXT_PUBLIC_LEGAL_EMAIL", "NEXT_PUBLIC_LEGAL_PHONE", "NEXT_PUBLIC_LEGAL_ADDRESS"];

export default function config(phase: string): NextConfig {
  const missing = legalEnv.filter((key) => !process.env[key]?.trim());
  if (phase === PHASE_PRODUCTION_BUILD && missing.length) {
    throw new Error(`Set ${missing.join(", ")} (see .env.example) for the legal pages.`);
  }
  return {
    reactStrictMode: true,
    // Pin the workspace root to this folder (there's another lockfile higher up).
    outputFileTracingRoot: path.join(__dirname),
    turbopack: {
      root: path.join(__dirname),
    },
  };
}
