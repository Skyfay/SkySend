import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { SNAPSHOTS, snapshotVersions } from "./tests/support/compat.js";
import type { TargetOptions } from "./tests/support/fixtures.js";

const CI = !!process.env.CI;
type WebServer = Extract<NonNullable<PlaywrightTestConfig["webServer"]>, unknown[]>[number];
/** Installed by `pnpm test:e2e:install`, see scripts/install-caddy.mjs. */
const CADDY = join(import.meta.dirname, ".tools", "caddy");

type Engine = "chromium" | "firefox" | "webkit";

type Target = Omit<TargetOptions, "storage"> & {
  name: string;
  /** The address the browsers open. */
  origin: string;
  /** The recording proxy of scripts/serve.mjs, with the server one port above it. */
  proxyPort: number;
  /** The reverse proxy in front, which serves the origin with TLS and HTTP/2. */
  proxy?: "caddy" | "nginx";
  /** A service the server needs beside it, started before the server on a port of its own. */
  service?: { kind: "s3" | "oidc"; port: number };
  env?: Record<string, string>;
  /** The specs this setup runs. Without it, everything but the specs of other setups. */
  testMatch?: string[];
  /** Picks the tests of this setup out of a spec several setups share, by the title. */
  tag?: string;
  /** The engines this setup runs in, all three when left out. */
  engines?: Engine[];
  /** The large-file setup, which runs alone and only with E2E_LARGE=1. */
  large?: boolean;
};

// What goes over the wire, which is what a reverse proxy or an upload transport can break.
const WIRE = [
  "**/files.spec.ts",
  "**/requests.spec.ts",
  "**/links.spec.ts",
  "**/transport.spec.ts",
];
const NOTES = "**/notes.spec.ts";
// The guard test needs the WebSocket route, which a server without FILE_UPLOAD_WS does not have.
const GUARD = "**/guard.spec.ts";
// Specs of their own setups, each test titled with the [tag] of its setup.
const COMPAT = "**/compat.spec.ts";
const CONFIG = "**/config.spec.ts";
const LARGE = "**/large.spec.ts";
// The engines behind a reverse proxy. WebKit on Linux speaks HTTP/2 and TLS through libsoup,
// a network stack no Safari has, so behind a proxy it would only test that. Chromium and
// Firefox ship the network stacks people use, and WebKit keeps its own path in the direct
// setup and with S3.
const PROXY_ENGINES: Engine[] = ["chromium", "firefox"];

/** Expiries of 5 seconds next to the defaults, for expiry.spec.ts. The defaults stay as they are. */
const SHORT_EXPIRY = {
  FILE_EXPIRE_OPTIONS_SEC: "5,300,3600,86400,604800",
  NOTE_EXPIRE_OPTIONS_SEC: "5,300,3600,86400,604800",
  FILE_REQUEST_EXPIRE_OPTIONS_SEC: "5,86400,259200,604800",
};

/** A setting of the server that config.spec.ts checks under the tag of the same name. */
function variant(name: string, proxyPort: number, env: Record<string, string>): Target {
  return {
    name,
    origin: `http://localhost:${proxyPort}`,
    proxyPort,
    protocol: "http/1.1",
    uploadTransport: "ws",
    env,
    testMatch: [CONFIG],
    tag: name,
    // A server setting acts the same in every browser.
    engines: ["chromium"],
  };
}

/**
 * The setups the tests run against. Each is a server of its own with its own data directory,
 * behind the recording proxy. The direct one runs every test of the app. The ones behind a
 * reverse proxy with TLS and HTTP/2 run what goes over the wire, set up like
 * docs/user-guide/self-hosting/reverse-proxy.md: Caddy through proxies/Caddyfile, Nginx with the
 * example read straight out of that page by scripts/nginx.mjs.
 */
const TARGETS: Target[] = [
  {
    name: "direct",
    origin: "http://localhost:3170",
    proxyPort: 3170,
    protocol: "http/1.1",
    uploadTransport: "ws",
    env: SHORT_EXPIRY,
  },
  {
    name: "caddy",
    origin: "https://localhost:3443",
    proxyPort: 3270,
    protocol: "h2",
    uploadTransport: "ws",
    proxy: "caddy",
    env: { TRUST_PROXY: "true" },
    // Notes run behind one proxy, which is enough for a single request each way.
    testMatch: [...WIRE, NOTES, GUARD],
    engines: PROXY_ENGINES,
  },
  {
    // Chunks over HTTP/2 is where uploads stalled behind proxies before, in v2.2.2 and v2.2.3.
    name: "caddy-chunks",
    origin: "https://localhost:3444",
    proxyPort: 3370,
    protocol: "h2",
    uploadTransport: "http",
    proxy: "caddy",
    env: { TRUST_PROXY: "true", FILE_UPLOAD_WS: "false" },
    testMatch: WIRE,
    engines: PROXY_ENGINES,
  },
  {
    name: "nginx",
    origin: "https://localhost:3445",
    proxyPort: 3470,
    protocol: "h2",
    uploadTransport: "ws",
    proxy: "nginx",
    env: { TRUST_PROXY: "true" },
    testMatch: [...WIRE, GUARD],
    engines: PROXY_ENGINES,
  },
  {
    name: "nginx-chunks",
    origin: "https://localhost:3446",
    proxyPort: 3570,
    protocol: "h2",
    uploadTransport: "http",
    proxy: "nginx",
    env: { TRUST_PROXY: "true", FILE_UPLOAD_WS: "false" },
    testMatch: WIRE,
    engines: PROXY_ENGINES,
  },
  {
    // A file of 5 GiB up through Nginx with TLS and HTTP/2 and down through the Service Worker,
    // past the 2 GiB and 4 GiB marks where a size overflows 32 bits. WebKit would assemble the
    // download in memory, which a file this size does not fit. The proxy records headers only.
    name: "large",
    origin: "https://localhost:3447",
    proxyPort: 3590,
    protocol: "h2",
    uploadTransport: "ws",
    proxy: "nginx",
    env: {
      TRUST_PROXY: "true",
      FILE_MAX_SIZE: "8GB",
      RECORD_BODIES: "false",
      WIPE_ON_EXIT: "true",
    },
    testMatch: [LARGE],
    engines: ["chromium"],
    large: true,
  },
  variant("forced-passwords", 3610, {
    FORCE_FILE_PASSWORD: "true",
    FORCE_NOTE_PASSWORD: "true",
    FORCE_REQUEST_PASSWORD: "true",
  }),
  variant("files-only", 3620, { ENABLED_SERVICES: "file" }),
  variant("notes-only", 3630, { ENABLED_SERVICES: "note" }),
  variant("requests-only", 3640, { ENABLED_SERVICES: "request" }),
  // Slow enough that an upload is still running when the test cancels it.
  variant("slow-uploads", 3650, { FILE_UPLOAD_SPEED_LIMIT: "1MB" }),
  {
    // Downloads come from the store through presigned URLs, in the Service Worker of Chromium
    // and in the page of WebKit, which needs the store's CORS. Firefox goes the way of Chromium.
    name: "s3",
    origin: "http://localhost:3660",
    proxyPort: 3660,
    protocol: "http/1.1",
    uploadTransport: "ws",
    service: { kind: "s3", port: 3668 },
    testMatch: ["**/files.spec.ts", "**/requests.spec.ts"],
    engines: ["chromium", "webkit"],
  },
  {
    ...variant("oidc", 3680, {}),
    service: { kind: "oidc", port: 3688 },
  },
  // One server per released version with a snapshot, which opens the links of that version.
  ...snapshotVersions().map((version, index): Target => ({
    name: `compat-${version}`,
    origin: `http://localhost:${3700 + index * 10}`,
    proxyPort: 3700 + index * 10,
    protocol: "http/1.1",
    uploadTransport: "ws",
    env: { SNAPSHOT: join(SNAPSHOTS, version, "data.tar.gz") },
    testMatch: [COMPAT],
    tag: version,
  })),
];

/** Whether the tools some setups need are there, and how to get them if not. */
const tools = {
  caddy: { ready: existsSync(CADDY), missing: "Caddy is not installed, run pnpm test:e2e:install" },
  // The Nginx image runs on the host network, which Docker Desktop on a Mac has to allow first.
  // A daemon still pulling an image on a disk under load answers late: on a CI runner whose
  // browser came from the cache, the tests started while the large job was still removing
  // toolchains, and 10 s were not enough (2026-10-23). Without Docker, or with its daemon down,
  // the command fails at once, so the long wait only applies to a daemon that is there.
  docker: {
    ready: spawnSync("docker", ["info"], { stdio: "ignore", timeout: 90_000 }).status === 0,
    missing: "Docker is not available, so Nginx and the S3 store cannot run",
  },
};
function needs(target: Target): keyof typeof tools | null {
  if (target.proxy === "caddy") return "caddy";
  if (target.proxy === "nginx" || target.service?.kind === "s3") return "docker";
  return null;
}

/**
 * Runs the projects of some engines only, with the servers and services those need and no
 * others: E2E_BROWSER=firefox, or a list like chromium,webkit. CI runs one job per engine, so
 * the Firefox job, for one, never pulls the S3 store, which only Chromium and WebKit test.
 */
const ENGINES: Engine[] = ["chromium", "firefox", "webkit"];
const BROWSERS = (process.env.E2E_BROWSER ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
for (const name of BROWSERS) {
  if (!ENGINES.includes(name as Engine)) throw new Error(`E2E_BROWSER names no engine: ${name}`);
}
/** The engines a setup runs in, within E2E_BROWSER. */
function enginesOf(target: Target): Engine[] {
  return (target.engines ?? ENGINES).filter(
    (engine) => BROWSERS.length === 0 || BROWSERS.includes(engine),
  );
}

/** The bucket of the S3 setup and the client of the OIDC one, see scripts/s3.mjs and oidc.mjs. */
const S3_BUCKET = "skysend-e2e";
const OIDC_CLIENT = {
  OIDC_CLIENT_ID: "skysend-e2e",
  OIDC_CLIENT_SECRET: "skysend-e2e-client-secret",
};

/** What the server of a setup needs to reach its service. */
function serviceEnv(target: Target): Record<string, string> {
  if (target.service?.kind === "s3") {
    return {
      STORAGE_BACKEND: "s3",
      S3_BUCKET,
      S3_REGION: "us-east-1",
      S3_ENDPOINT: `http://127.0.0.1:${target.service.port}`,
      S3_ACCESS_KEY: "skysend-e2e",
      S3_SECRET_KEY: "skysend-e2e-secret",
      // A bucket in the host name would not resolve on 127.0.0.1.
      S3_FORCE_PATH_STYLE: "true",
    };
  }
  if (target.service?.kind === "oidc") {
    return {
      ...OIDC_CLIENT,
      OIDC_PROVIDER: "generic",
      OIDC_ISSUER: `https://localhost:${target.service.port}`,
      OIDC_SESSION_SECRET: "skysend-e2e-session-secret-of-at-least-32-characters",
      OIDC_PROTECT_FILES: "true",
      OIDC_PROTECT_NOTES: "true",
      // The provider signs its own certificate. Only this server of the tests accepts that.
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    };
  }
  return {};
}

/**
 * Moves every port, data directory and container by this much, so a second run can go beside
 * one that holds the usual ports, like an open UI mode: E2E_PORT_OFFSET=1000 pnpm test:e2e.
 */
const OFFSET = Number(process.env.E2E_PORT_OFFSET ?? 0);
const SUFFIX = OFFSET ? `-${OFFSET}` : "";
function shifted(target: Target): Target {
  const origin = new URL(target.origin);
  origin.port = String(Number(origin.port) + OFFSET);
  return {
    ...target,
    origin: origin.origin,
    proxyPort: target.proxyPort + OFFSET,
    ...(target.service
      ? { service: { ...target.service, port: target.service.port + OFFSET } }
      : {}),
  };
}

/**
 * E2E_LARGE=1 (`pnpm test:e2e:large`) runs the large-file setup and nothing else, the other way
 * round every other run leaves it out. Its server data and its download go to e2e/.large-files
 * and the source file to test-results, all on the disk of the checkout, about 11 GB at the peak.
 * The temp folder lives in memory on some systems, where gigabytes do not fit.
 */
const LARGE_RUN = !!process.env.E2E_LARGE;
const LARGE_FILES = join(import.meta.dirname, ".large-files");
const LARGE_DOWNLOADS = join(LARGE_FILES, `downloads${SUFFIX}`);
if (LARGE_RUN) mkdirSync(LARGE_DOWNLOADS, { recursive: true });
const selected = TARGETS.map(shifted).filter(
  (target) => enginesOf(target).length > 0 && !!target.large === LARGE_RUN,
);
for (const [name, tool] of Object.entries(tools)) {
  if (tool.ready || !selected.some((target) => needs(target) === name)) continue;
  if (CI) throw new Error(tool.missing);
  if (!process.env.TEST_WORKER_INDEX) {
    console.warn(`${tool.missing}. The tests behind it are left out.`);
  }
}
const targets = selected.filter((target) => {
  const tool = needs(target);
  return !tool || tools[tool].ready;
});
const behind = (proxy: Target["proxy"]) => targets.filter((target) => target.proxy === proxy);
const [caddyWs, caddyChunks] = behind("caddy");

// Each engine takes its own download path, see apps/web/src/lib/download-tiers.ts.
const engines: Array<[Engine, (typeof devices)[string]]> = [
  ["chromium", devices["Desktop Chrome"]],
  ["firefox", devices["Desktop Firefox"]],
  ["webkit", devices["Desktop Safari"]],
];

// No web server is ever reused. One left over from an earlier run, like a UI mode that is still
// open, would serve its old configuration, and the tests would pass or fail against that. A
// taken port fails the run instead, with the port in the message.

/** Every test comes from the same address, so the limits per address are out of the way. */
const serverEnv = {
  HOST: "127.0.0.1",
  RATE_LIMIT_MAX: "100000",
  FILE_UPLOAD_QUOTA_BYTES: "0",
  FILE_REQUEST_DAILY_LIMIT: "10000",
  // A share that ran out says so, instead of vanishing in a sweep halfway through a test.
  CLEANUP_INTERVAL: "86400",
};

/**
 * The tests run against the production build: the server serves the SPA and the API from one
 * origin, the way an instance does. Run `pnpm test:e2e` at the root, which builds first.
 */
export default defineConfig<TargetOptions>({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 3 : undefined,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: targets.flatMap((target) =>
    engines
      .filter(([engine]) => enginesOf(target).includes(engine))
      .map(([engine, device]) => {
        // Caddy signs with its own CA, which no browser knows.
        const https = target.origin.startsWith("https:");
        return {
          name: target.name === "direct" ? engine : `${engine}-${target.name}`,
          ...(target.testMatch
            ? { testMatch: target.testMatch }
            : { testIgnore: [COMPAT, CONFIG, LARGE] }),
          ...(target.tag ? { grep: new RegExp(`\\[${target.tag.replaceAll(".", "\\.")}\\]`) } : {}),
          use: {
            ...device,
            baseURL: target.origin,
            // The OIDC provider signs its own certificate as well.
            ignoreHTTPSErrors: https || target.service?.kind === "oidc",
            launchOptions: {
              // Chromium refuses a Service Worker from an origin with a certificate error unless
              // the whole browser ignores such errors, which a trusted certificate makes moot on
              // a real instance.
              ...(https && engine === "chromium" ? { args: ["--ignore-certificate-errors"] } : {}),
              ...(target.large ? { downloadsPath: LARGE_DOWNLOADS } : {}),
            },
            // A trace or a video of gigabytes going through would only fill the disk.
            ...(target.large ? { trace: "off" as const, video: "off" as const } : {}),
            protocol: target.protocol,
            uploadTransport: target.uploadTransport,
            storage: target.service?.kind === "s3" ? "s3" : "filesystem",
          },
        };
      }),
  ),
  webServer: [
    // The services start first, since a server checks its S3 bucket when it starts.
    ...targets.flatMap((target): WebServer[] => {
      const service = target.service;
      if (service?.kind === "s3") {
        return [
          {
            command: `node scripts/s3.mjs ${target.name}${SUFFIX} ${service.port} ${S3_BUCKET}`,
            // Answers once the bucket exists.
            url: `http://127.0.0.1:${service.port}/${S3_BUCKET}`,
            reuseExistingServer: false,
            timeout: 180_000,
            gracefulShutdown: { signal: "SIGTERM" as const, timeout: 10_000 },
          },
        ];
      }
      if (service?.kind === "oidc") {
        return [
          {
            command: `node scripts/oidc.mjs ${target.name}${SUFFIX} ${service.port} ${target.origin}/auth/callback`,
            url: `https://localhost:${service.port}/.well-known/openid-configuration`,
            ignoreHTTPSErrors: true,
            reuseExistingServer: false,
            env: OIDC_CLIENT,
          },
        ];
      }
      return [];
    }),
    ...targets.map((target) => ({
      command: "node scripts/serve.mjs",
      url: `http://127.0.0.1:${target.proxyPort}/api/health`,
      reuseExistingServer: false,
      env: {
        ...serverEnv,
        ...target.env,
        ...serviceEnv(target),
        PROXY_PORT: String(target.proxyPort),
        PORT: String(target.proxyPort + 1),
        BASE_URL: target.origin,
        DATA_DIR: target.large
          ? join(LARGE_FILES, `server${SUFFIX}`)
          : join(tmpdir(), `skysend-e2e-${target.name}${SUFFIX}`),
      },
      // A killed server cannot remove its data, see WIPE_ON_EXIT in scripts/serve.mjs. The server
      // itself gives up after 10 seconds of waiting for connections.
      ...(target.env?.WIPE_ON_EXIT
        ? { gracefulShutdown: { signal: "SIGTERM" as const, timeout: 15_000 } }
        : {}),
    })),
    // The proxies start after the servers, whose health they answer for.
    ...(caddyWs && caddyChunks
      ? [
          {
            command: `${CADDY} run --config proxies/Caddyfile --adapter caddyfile`,
            url: `${caddyWs.origin}/api/health`,
            ignoreHTTPSErrors: true,
            reuseExistingServer: false,
            env: {
              E2E_CADDY_STORAGE: join(tmpdir(), `skysend-e2e-proxy-caddy${SUFFIX}`),
              E2E_CADDY_WS_PORT: new URL(caddyWs.origin).port,
              E2E_CADDY_WS_UPSTREAM: String(caddyWs.proxyPort),
              E2E_CADDY_CHUNKS_PORT: new URL(caddyChunks.origin).port,
              E2E_CADDY_CHUNKS_UPSTREAM: String(caddyChunks.proxyPort),
            },
          },
        ]
      : []),
    ...behind("nginx").map((target) => ({
      command: `node scripts/nginx.mjs ${target.name}${SUFFIX} ${new URL(target.origin).port} ${target.proxyPort}`,
      url: `${target.origin}/api/health`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      // The first start pulls the image.
      timeout: 180_000,
      // Playwright kills a web server outright unless told otherwise, and the container would
      // outlive the killed script. SIGTERM lets the script remove it.
      gracefulShutdown: { signal: "SIGTERM" as const, timeout: 10_000 },
    })),
  ],
});
