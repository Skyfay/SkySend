import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const rootPkg = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf-8"),
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    coverage: {
      include: ["src/lib/**/*.ts"],
      exclude: [
        // Browser OPFS / Worker context - not unit-testable in Node
        "src/lib/opfs-download.ts",
        "src/lib/opfs-worker.ts",
        "src/lib/upload-worker.ts",
        // HTTP/Fetch client - integration-level, not unit-testable without a server
        "src/lib/api.ts",
        // Browser-only WASM / Web Crypto wrappers
        "src/lib/argon2.ts",
        "src/lib/ssh-keygen.ts",
        "src/lib/zip.ts",
      ],
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
