import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    env: {
      MARKETING_HUB_DATA_DIR: "/tmp/marketing-hub-vitest",
      MARKETING_HUB_DEMO_MODE: "true"
    }
  }
});
