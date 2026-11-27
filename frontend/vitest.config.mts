import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // tsconfig keeps JSX for Next to compile; tests compile it themselves.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // Stand-ins for the contact details that .env.local or Vercel provide.
    env: {
      NEXT_PUBLIC_LEGAL_NAME: "Test Operator",
      NEXT_PUBLIC_LEGAL_EMAIL: "support@example.com",
      NEXT_PUBLIC_LEGAL_PHONE: "+91 90000 00000",
      NEXT_PUBLIC_LEGAL_ADDRESS: "1 Test Street, Hyderabad, Telangana 500001, India",
    },
    mockReset: true,
  },
});
