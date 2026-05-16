import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const rootPkg = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf-8"),
);

export default defineConfig(({ command }) => {
  const ogImage = process.env.VITE_OG_IMAGE ?? "/logo.png";
  // In dev mode (Vite dev server) the server middleware is not involved,
  // so replace the placeholder directly with the env value.
  const customTitle = command === "serve"
    ? (process.env.CUSTOM_TITLE ?? "SkySend")
    : "__CUSTOM_TITLE__";

  return {
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "inject-html-vars",
      transformIndexHtml(html) {
        return html
          .replace(/%VITE_OG_IMAGE%/g, ogImage)
          .replace(/__CUSTOM_TITLE__/g, customTitle);
      },
    },
  ],
  test: {
    coverage: {
      include: ["src/lib/**/*.ts", "src/hooks/**/*.ts"],
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
        target: `http://localhost:${process.env.SERVER_PORT ?? 3000}`,
        changeOrigin: true,
        ws: true,
      },
      "/auth": {
        target: `http://localhost:${process.env.SERVER_PORT ?? 3000}`,
        changeOrigin: true,
      },
    },
  },
  };
});
