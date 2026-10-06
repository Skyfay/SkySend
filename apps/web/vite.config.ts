import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const rootPkg = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf-8"),
);

// The API server reads .env.dev through --env-file, Vite does not. In dev the values that
// go into index.html come from that file, and a variable set in the shell still wins.
const devEnvFile = resolve(__dirname, "../../.env.dev");

function readDevEnv(): Record<string, string | undefined> {
  const fileEnv = existsSync(devEnvFile) ? parseEnv(readFileSync(devEnvFile, "utf-8")) : {};
  return { ...fileEnv, ...process.env };
}

export default defineConfig(({ command }) => {
  // In dev mode (Vite dev server) the server middleware is not involved,
  // so replace the placeholder directly with the env value.
  const env = command === "serve" ? readDevEnv() : {};
  const customTitle = command === "serve"
    ? (env.CUSTOM_TITLE ?? "SkySend")
    : "__CUSTOM_TITLE__";
  // Link previews never reach the dev server, so the built-in defaults are enough there.
  const ogImage = command === "serve" ? "/logo.png" : "__OG_IMAGE__";
  const twitterCard = command === "serve" ? "summary" : "__TWITTER_CARD__";
  const envTheme = env.DEFAULT_THEME ?? "";
  const defaultTheme = command === "serve"
    ? (["aurora", "midnight", "graphite"].includes(envTheme) ? envTheme : "graphite")
    : "__DEFAULT_THEME__";
  const envColorScheme = env.DEFAULT_COLOR_SCHEME ?? "";
  const defaultColorScheme = command === "serve"
    ? (["dark", "light", "system"].includes(envColorScheme) ? envColorScheme : "system")
    : "__DEFAULT_COLOR_SCHEME__";

  return {
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "inject-html-vars",
      // index.html is filled when the config loads, so a change to .env.dev restarts Vite.
      configureServer(server) {
        server.watcher.add(devEnvFile);
        server.watcher.on("change", (file) => {
          if (file === devEnvFile) void server.restart();
        });
      },
      transformIndexHtml(html) {
        return html
          .replace(/__CUSTOM_TITLE__/g, customTitle)
          .replace(/__DEFAULT_THEME__/g, defaultTheme)
          .replace(/__DEFAULT_COLOR_SCHEME__/g, defaultColorScheme)
          .replace(/__OG_IMAGE__/g, ogImage)
          .replace(/__TWITTER_CARD__/g, twitterCard);
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
      // Operator-supplied branding assets are served by the API server.
      "/branding": {
        target: `http://localhost:${process.env.SERVER_PORT ?? 3000}`,
        changeOrigin: true,
      },
    },
  },
  };
});
