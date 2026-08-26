// Import Vitest's typed configuration helper.
import { defineConfig } from "vitest/config";

// Export one deterministic test configuration for CI and local development.
export default defineConfig({
  // Keep tests in a normal Node environment because tested helpers are platform-neutral.
  test: {
    // Only files with this suffix belong to the automated suite.
    include: ["tests/**/*.test.ts"],
    // A Persian failure message stays readable with the default reporter.
    reporters: ["default"],
  },
});
