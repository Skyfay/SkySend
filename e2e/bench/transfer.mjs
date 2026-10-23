// Measures one upload and one download of a large file through the real app in a real browser,
// against the built server, and records the speed of every hop over time. Not a test: it fails
// only when the transfer fails or the file comes back different, and prints what it measured.
//
//   browser --> [proxy A] --> server --> [proxy B] --> S3
//
// Proxy A counts what the browser sends to the server and gets back from it. Proxy B counts what
// the server sends to the bucket, and since the presigned download URLs point at it as well, what
// the browser downloads from the bucket. Both are plain TCP relays, so they change nothing on the
// wire. The page records the progress the upload worker reports, which is what the UI shows.
//
// With --client cli the end-user CLI takes the place of the browser: the same server, relays and
// sampler, the CLI process measured where the browser would be.
//
// Build first (pnpm test:e2e:build), then for example:
//   node e2e/bench/transfer.mjs --browser firefox --storage s3 --size 2048
// See e2e/bench/README.md for every option.
/* global window, document -- the recorder and page.evaluate callbacks run in the browser. */
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomFillSync } from "node:crypto";
import {
  createReadStream,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import net from "node:net";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, firefox, webkit } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..", "..");
const WORK = join(ROOT, "e2e", ".large-files", "bench");
const MIB = 1024 * 1024;

const { values: opts } = parseArgs({
  options: {
    browser: { type: "string", default: "chromium" },
    storage: { type: "string", default: "fs" },
    s3: { type: "string", default: "local" },
    // With --s3 env, the bucket of a real provider, from the S3_* lines of this env file.
    "s3-env": { type: "string", default: ".env.dev" },
    // A Chromium build to drive instead of Playwright's, like /usr/bin/brave-browser.
    executable: { type: "string" },
    transport: { type: "string", default: "ws" },
    size: { type: "string", default: "1024" },
    label: { type: "string" },
    env: { type: "string", multiple: true, default: [] },
    "no-verify": { type: "boolean", default: false },
    "no-download": { type: "boolean", default: false },
    profile: { type: "boolean", default: false },
    port: { type: "string", default: "3900" },
    // "nginx" puts the Nginx of the reverse proxy guide in front, with TLS and HTTP/2, the
    // way an instance runs. The browser then opens https://localhost.
    proxy: { type: "string" },
    // Chromium defaults to the full browser in its new headless mode, which is what people
    // run, not the headless shell the end-to-end tests use. "shell" picks the shell.
    channel: { type: "string" },
    // Several senders upload the same file at once, and nothing is downloaded. Shows what
    // parallel uploads cost the server, in memory above all.
    parallel: { type: "string", default: "1" },
    // Closes the sender this many seconds into the upload, the way a person closes the tab.
    // What it leaves behind shows whether an abandoned upload is cleaned up.
    "cancel-after": { type: "string" },
    // Uploads and downloads that run at the same time, each in a browser context of its own,
    // like people on different machines. The downloads are of files uploaded beforehand.
    uploads: { type: "string" },
    downloads: { type: "string" },
    // Empties the page cache before the transfers of a mixed run start (sudo).
    "drop-caches": { type: "boolean", default: false },
    // Every transfer of a mixed run in a browser of its own instead of a context of one
    // browser, so they share no network stack and no process, like people on other machines.
    separate: { type: "boolean", default: false },
    // The browser talks to the server directly, without proxy A, which runs in this process
    // and could be the limit itself. Upload speeds then come from the worker alone.
    direct: { type: "boolean", default: false },
    // "cli" runs the end-user CLI instead of a browser, the binary of --cli-bin.
    client: { type: "string", default: "web" },
    // The Bun binary people install, which `pnpm client:compile` writes. `node dist/index.js`
    // would measure Node instead.
    "cli-bin": { type: "string", default: "apps/client/dist/skysend" },
    // Sends this many files of --size at once, which the app and the CLI pack into one zip.
    files: { type: "string", default: "1" },
  },
});

/** The S3 settings of a real bucket, from an env file. Its keys are never printed. */
function s3FromEnvFile(file) {
  const env = {};
  for (const line of readFileSync(resolve(ROOT, file), "utf8").split("\n")) {
    const match = /^\s*(S3_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  for (const key of ["S3_BUCKET", "S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY"]) {
    if (!env[key]) throw new Error(`${file} has no ${key}`);
  }
  return { STORAGE_BACKEND: "s3", ...env };
}

if (!["web", "cli"].includes(opts.client)) throw new Error("--client must be web or cli");
const CLI = opts.client === "cli";
if (CLI && (opts.uploads || opts.downloads || Number(opts.parallel) > 1 || opts["cancel-after"]))
  throw new Error("--client cli runs one upload and its download only");
const engines = { chromium, firefox, webkit };
const engine = engines[opts.browser];
if (!engine) throw new Error(`--browser must be one of ${Object.keys(engines).join(", ")}`);
if (!["fs", "s3"].includes(opts.storage)) throw new Error("--storage must be fs or s3");
if (!["ws", "http"].includes(opts.transport)) throw new Error("--transport must be ws or http");

const SIZE = Number(opts.size) * MIB;
const FILES = Number(opts.files);
if (!Number.isInteger(FILES) || FILES < 1) throw new Error("--files must be a whole number from 1");
/** What one upload sends, all files together. */
const TOTAL = SIZE * FILES;
const BASE = Number(opts.port);
const PORTS = { proxyA: BASE, server: BASE + 1, proxyB: BASE + 2, s3: BASE + 3 };
if (opts.proxy && opts.proxy !== "nginx") throw new Error("--proxy must be nginx");
const TLS_PORT = BASE + 6;
const ORIGIN = opts.proxy
  ? `https://localhost:${TLS_PORT}`
  : `http://127.0.0.1:${opts.direct ? PORTS.server : PORTS.proxyA}`;
const BUCKET = "skysend-bench";
const label =
  opts.label ??
  `${CLI ? "cli" : opts.browser}-${opts.storage}${opts.storage === "s3" ? `-${opts.s3}` : ""}-${opts.transport}-${opts.size}m${FILES > 1 ? `x${FILES}` : ""}`;

const cleanups = [];
async function cleanup() {
  while (cleanups.length > 0) await Promise.resolve(cleanups.pop()()).catch(() => {});
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void cleanup().then(() => process.exit(130)));
}

/** The source file, kept between runs since writing it takes longer than some transfers. */
async function sourceFile(size) {
  mkdirSync(WORK, { recursive: true });
  const path = join(WORK, `source-${size}.bin`);
  const sidecar = `${path}.sha256`;
  if (existsSync(path) && existsSync(sidecar))
    return { path, sha256: readFileSync(sidecar, "utf8") };
  // Random bytes, so no layer can compress them away. Ciphertext is random anyway.
  const hash = createHash("sha256");
  const block = Buffer.alloc(8 * MIB);
  const file = await open(path, "w");
  for (let offset = 0; offset < size; offset += block.length) {
    const bytes = block.subarray(0, Math.min(block.length, size - offset));
    randomFillSync(bytes);
    hash.update(bytes);
    await file.write(bytes);
  }
  await file.close();
  const sha256 = hash.digest("hex");
  writeFileSync(sidecar, sha256);
  return { path, sha256 };
}

/**
 * The files one upload sends. Several are hard links to the one source file under names of their
 * own, so they cost no disk and the zip gets distinct names.
 */
async function sourceFiles(size, count) {
  const source = await sourceFile(size);
  if (count === 1) return { ...source, paths: [source.path] };
  const dir = join(WORK, `multi-${size}`);
  mkdirSync(dir, { recursive: true });
  const paths = [];
  for (let i = 1; i <= count; i++) {
    const path = join(dir, `part-${i}.bin`);
    if (!existsSync(path)) linkSync(source.path, path);
    paths.push(path);
  }
  return { ...source, paths };
}

/**
 * Whether a download is what was sent: the file itself, or for several files a zip whose every
 * entry has the hash of the source. Python's zipfile reads ZIP64 the way unzip tools do.
 */
async function downloadIntact(path, source) {
  if (FILES === 1) return (await hashFile(path)) === source.sha256;
  const check = [
    "import hashlib, sys, zipfile",
    "z = zipfile.ZipFile(sys.argv[1])",
    "names = z.namelist()",
    "ok = len(names) == int(sys.argv[3])",
    "for n in names:",
    "    h = hashlib.sha256()",
    "    with z.open(n) as f:",
    "        for b in iter(lambda: f.read(8 << 20), b''): h.update(b)",
    "    ok = ok and h.hexdigest() == sys.argv[2]",
    "print('ok' if ok else 'bad')",
  ].join("\n");
  try {
    const out = execFileSync("python3", ["-c", check, path, source.sha256, String(FILES)]);
    return out.toString().trim() === "ok";
  } catch {
    return false;
  }
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 8 * MIB })) hash.update(chunk);
  return hash.digest("hex");
}

/** A TCP relay that counts the bytes in each direction. */
/**
 * Which transfer a request belongs to, from its request line: a download by the ID in its path,
 * a WebSocket upload by the order its socket opened in, a chunk by the ID of its upload.
 */
const REQUEST_LINE = /^(GET|POST|PUT|HEAD|DELETE|OPTIONS) (\S+) HTTP\/1\.1/;
function labelOf(path, counter) {
  const id = /([0-9a-f]{8})-[0-9a-f-]{27}/.exec(path)?.[1];
  if (/^\/api\/upload\/ws/.test(path)) return `up:ws${++counter.sockets}`;
  if (/^\/api\/download\//.test(path) || /\.bin\?/.test(path)) return id ? `down:${id}` : null;
  if (/\/chunk\?/.test(path) || /[?&]partNumber=/.test(path)) return id ? `up:${id}` : null;
  return null;
}

function countingProxy(listenPort, host, port) {
  // labels: bytes per transfer, see labelOf. Only request lines at the start of a read are
  // looked at, which is where a new request on a connection starts.
  const counter = { up: 0, down: 0, connections: 0, sockets: 0, labels: new Map() };
  const sockets = new Set();
  const server = net.createServer((client) => {
    counter.connections++;
    const upstream = net.connect({ host, port });
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    sockets.add(client).add(upstream);
    let label = null;
    let upgraded = false;
    const count = (direction, bytes) => {
      if (!label) return;
      const entry = counter.labels.get(label) ?? { up: 0, down: 0 };
      entry[direction] += bytes;
      counter.labels.set(label, entry);
    };
    client.on("data", (data) => {
      counter.up += data.length;
      if (!upgraded && data.length > 16) {
        const line = REQUEST_LINE.exec(data.toString("latin1", 0, Math.min(data.length, 8192)));
        if (line) {
          label = labelOf(line[2], counter);
          upgraded = /^\/api\/upload\/ws/.test(line[2]);
        }
      }
      count("up", data.length);
    });
    upstream.on("data", (data) => {
      counter.down += data.length;
      count("down", data.length);
    });
    client.pipe(upstream);
    upstream.pipe(client);
    const end = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("error", end).on("close", end);
    upstream.on("error", end).on("close", end);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "127.0.0.1", () => {
      cleanups.push(() => {
        for (const socket of sockets) socket.destroy();
        server.close();
      });
      resolve(counter);
    });
  });
}

async function waitFor(url, what, attempts = 240) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const answer = await fetch(url).catch(() => null);
    if (answer?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${what} did not come up at ${url}`);
}

/** Starts SeaweedFS on this machine, or points at an existing store, and makes the bucket. */
async function startS3() {
  let target = opts.s3;
  if (opts.s3 === "local") {
    const name = "skysend-bench-s3";
    execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" });
    const image = (await import("../scripts/images.mjs")).IMAGES.s3;
    execFileSync(
      "docker",
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        name,
        "--publish",
        `127.0.0.1:${PORTS.s3}:8333`,
        image,
        "server",
        "-s3",
        "-master.telemetry=false",
      ],
      { stdio: "ignore" },
    );
    cleanups.push(() => execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }));
    target = `http://127.0.0.1:${PORTS.s3}`;
    await waitFor(target, "SeaweedFS");
  }
  // SeaweedFS without identities takes an unsigned request. An existing bucket answers 409.
  const created = await fetch(`${target}/${BUCKET}`, { method: "PUT" });
  if (!created.ok && created.status !== 409)
    throw new Error(`Creating the bucket failed with ${created.status}`);
  const url = new URL(target);
  return { host: url.hostname, port: Number(url.port || 80) };
}

function startServer(extraEnv) {
  const dataDir = join(WORK, "data");
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const env = {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(PORTS.server),
    BASE_URL: ORIGIN,
    ...(opts.proxy ? { TRUST_PROXY: "true" } : {}),
    DATA_DIR: dataDir,
    FILE_MAX_SIZE: "64GB",
    FILE_UPLOAD_WS: opts.transport === "ws" ? "true" : "false",
    RATE_LIMIT_MAX: "100000",
    FILE_UPLOAD_QUOTA_BYTES: "0",
    CLEANUP_INTERVAL: "86400",
    ...extraEnv,
  };
  for (const pair of opts.env) {
    const at = pair.indexOf("=");
    env[pair.slice(0, at)] = pair.slice(at + 1);
  }
  const args = [];
  if (opts.profile) {
    const profiles = join(WORK, "profiles", label);
    rmSync(profiles, { recursive: true, force: true });
    args.push("--cpu-prof", `--cpu-prof-dir=${profiles}`);
  }
  const child = spawn(
    process.execPath,
    [...args, join(ROOT, "apps", "server", "dist", "index.js")],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const log = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (data) => log.push(...data.toString().split("\n").filter(Boolean)));
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  // SIGTERM lets the server shut down, which also writes the CPU profile.
  cleanups.push(async () => {
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    child.kill("SIGKILL");
  });
  return { child, log, env };
}

const TICKS = 100;
/** CPU seconds a process has used so far, user and system. */
function cpuSeconds(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return (Number(fields[11]) + Number(fields[12])) / TICKS;
  } catch {
    return 0;
  }
}
function rssBytes(pid) {
  try {
    const match = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return match ? Number(match[1]) * 1024 : 0;
  } catch {
    return 0;
  }
}
/** A process and everything it started, like the renderers and the GPU process of a browser. */
function processTree(root) {
  const children = new Map();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(entry));
    } catch {
      // Gone meanwhile.
    }
  }
  const tree = [];
  const queue = [root];
  while (queue.length > 0) {
    const pid = queue.pop();
    tree.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return tree;
}

/**
 * The processes of the browser. Playwright starts the browser as a child of this process, beside
 * the server, so it is everything below this process but the server and what the server started.
 */
function browserTree(serverPid) {
  const server = new Set(processTree(serverPid));
  return processTree(process.pid).filter((pid) => pid !== process.pid && !server.has(pid));
}

/** The block device the bench writes to, as /proc/diskstats names it, like "sdb2". */
function benchDevice() {
  try {
    const source = execFileSync("findmnt", ["-n", "-o", "SOURCE", "--target", WORK])
      .toString()
      .trim();
    return source.replace(/^\/dev\//, "");
  } catch {
    return null;
  }
}
const DEVICE = benchDevice();
/** Bytes read and written on that device so far. */
function diskBytes() {
  if (!DEVICE) return { read: 0, written: 0 };
  const line = readFileSync("/proc/diskstats", "utf8")
    .split("\n")
    .find((row) => row.trim().split(/\s+/)[2] === DEVICE);
  if (!line) return { read: 0, written: 0 };
  const fields = line.trim().split(/\s+/);
  return { read: Number(fields[5]) * 512, written: Number(fields[9]) * 512 };
}

/** Samples every counter and both processes until stopped. */
function startSampler(counters, serverPid) {
  const samples = [];
  let tree = browserTree(serverPid);
  let treeAge = 0;
  const sample = () => {
    // A browser keeps its processes, a CLI is a new process per command and has to be found at once.
    if (++treeAge >= (CLI ? 1 : 8)) {
      tree = browserTree(serverPid);
      treeAge = 0;
    }
    const disk = diskBytes();
    const labels = {};
    for (const counter of [counters.a, counters.b]) {
      for (const [key, value] of counter?.labels ?? []) labels[key] = { ...value };
    }
    samples.push({
      t: Date.now(),
      diskRead: disk.read,
      diskWritten: disk.written,
      labels,
      aUp: counters.a.up,
      aDown: counters.a.down,
      bUp: counters.b?.up ?? 0,
      bDown: counters.b?.down ?? 0,
      serverCpu: cpuSeconds(serverPid),
      // The main thread alone, where all JavaScript of the server runs.
      serverMainCpu: cpuSeconds(`${serverPid}/task/${serverPid}`),
      serverRss: rssBytes(serverPid),
      browserCpu: tree.reduce((sum, pid) => sum + cpuSeconds(pid), 0),
      browserRss: tree.reduce((sum, pid) => sum + rssBytes(pid), 0),
    });
  };
  sample();
  const timer = setInterval(sample, 100);
  return {
    samples,
    stop() {
      clearInterval(timer);
      sample();
    },
  };
}

/** Rates over windows of `windowMs` between `from` and `to`, in MiB/s. */
function rates(samples, key, from, to, windowMs) {
  const inside = samples.filter((s) => s.t >= from && s.t <= to);
  const out = [];
  for (let start = 0; start < inside.length;) {
    let end = start;
    while (end < inside.length - 1 && inside[end].t - inside[start].t < windowMs) end++;
    if (end === start) break;
    const span = (inside[end].t - inside[start].t) / 1000;
    out.push((inside[end][key] - inside[start][key]) / MIB / span);
    start = end;
  }
  return out;
}

function stats(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const round = (v) => Math.round(v * 10) / 10;
  return {
    mean: round(mean),
    p10: round(at(0.1)),
    p50: round(at(0.5)),
    p90: round(at(0.9)),
    min: round(sorted[0]),
    max: round(sorted.at(-1)),
    // Spread relative to the mean, the number behind "the speed goes up and down".
    cv: Math.round((sd / mean) * 100) / 100,
    stalls: values.filter((v) => v < mean * 0.25).length,
  };
}

/** What a phase cost the server and the browser, from the samples between `from` and `to`. */
function cost(samples, from, to) {
  const inside = samples.filter((s) => s.t >= from && s.t <= to);
  if (inside.length < 2) return null;
  const first = inside[0];
  const last = inside.at(-1);
  const seconds = (last.t - first.t) / 1000;
  return {
    serverCpuPercent: Math.round(((last.serverCpu - first.serverCpu) / seconds) * 100),
    serverMainThreadPercent: Math.round(
      ((last.serverMainCpu - first.serverMainCpu) / seconds) * 100,
    ),
    browserCpuPercent: Math.round(((last.browserCpu - first.browserCpu) / seconds) * 100),
    serverPeakRssMiB: Math.round(Math.max(...inside.map((s) => s.serverRss)) / MIB),
    browserPeakRssMiB: Math.round(Math.max(...inside.map((s) => s.browserRss)) / MIB),
  };
}

const RECORDER = () => {
  // What the page shows every half second while a transfer runs: the percent of the progress
  // bar and the text beside it, with the speed. The same bar serves uploads and downloads.
  const shown = [];
  Object.defineProperty(window, "__shown", { value: shown });
  setInterval(() => {
    const bar = document.querySelector('[role="progressbar"]');
    if (!bar) return;
    const text = (bar.parentElement?.innerText ?? "").replace(/\s+/g, " ").slice(0, 120);
    shown.push({ t: Date.now(), text });
  }, 500);
  // Wraps Worker so every message the upload worker posts is kept with its time. Only the
  // fields that describe progress are kept, never a whole message, since one carries the secret.
  const log = [];
  Object.defineProperty(window, "__bench", { value: log });
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", (event) => {
        const m = event.data;
        if (!m || typeof m.type !== "string") return;
        if (!["progress", "phase", "transport", "storage"].includes(m.type)) return;
        log.push({
          t: Date.now(),
          type: m.type,
          loaded: m.loaded,
          total: m.total,
          phase: m.phase,
          transport: m.transport,
          backend: m.backend,
        });
      });
    }
  };
};

/**
 * What the page showed during a transfer: the speeds it displayed in MiB/s, how far they
 * spread and jumped, and how the percent moved, next to the speed the transfer really had.
 */
function shownSummary(shown, start, end, realMiBps) {
  const inside = shown.filter((s) => s.t >= start && s.t <= end);
  const speeds = [];
  const percents = [];
  // Each reading as [seconds since start, percent, speed in MiB/s], numbers only, never the text.
  const timeline = [];
  for (const s of inside) {
    const speed = /(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)\/s/.exec(s.text);
    let mibps = null;
    if (speed) {
      const factor = { B: 1 / 1024 ** 2, KB: 1 / 1024, MB: 1, GB: 1024 }[speed[2]];
      mibps = Number(speed[1]) * factor;
      speeds.push({ t: s.t, mibps });
    }
    const percent = /(\d+)%/.exec(s.text);
    if (percent) percents.push({ t: s.t, value: Number(percent[1]) });
    timeline.push([(s.t - start) / 1000, percent ? Number(percent[1]) : null, mibps]);
  }
  const values = speeds.map((s) => s.mibps).sort((a, b) => a - b);
  const at = (q) => (values.length ? values[Math.min(values.length - 1, Math.floor(q * values.length))] : null);
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const sd = mean === null ? null : Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  // The largest change between two readings half a second apart, relative to the real speed.
  let jump = 0;
  for (let i = 1; i < speeds.length; i++) jump = Math.max(jump, Math.abs(speeds[i].mibps - speeds[i - 1].mibps));
  // Whether the percent ever went back, and how long it stood still at the end.
  let backwards = false;
  for (let i = 1; i < percents.length; i++) if (percents[i].value < percents[i - 1].value) backwards = true;
  const last = percents.at(-1);
  const firstAtLast = last ? percents.find((p) => p.value === last.value) : null;
  const round = (v) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    readings: inside.length,
    firstSpeedAfter: speeds.length ? round((speeds[0].t - start) / 1000) : null,
    shownMiBps: { p10: round(at(0.1)), median: round(at(0.5)), p90: round(at(0.9)), cv: mean ? round(sd / mean) : null },
    realMiBps: round(realMiBps),
    largestJumpMiBps: round(jump),
    percentWentBack: backwards,
    lastPercent: last?.value ?? null,
    stoodAtLastPercentSeconds: firstAtLast ? round((end - firstAtLast.t) / 1000) : null,
    timeline,
  };
}

/** A screenshot of the page once its progress bar reached half, while the transfer goes on. */
function screenshotAtHalf(page, name) {
  const dir = join(WORK, "screenshots");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${label}-${name}-${Date.now()}.png`);
  return page
    .waitForFunction(
      // The bar carries no aria-valuenow, the percent stands in the text beside it.
      () => {
        const text = document.querySelector('[role="progressbar"]')?.parentElement?.innerText ?? "";
        return Number(/(\d+)%/.exec(text)?.[1] ?? 0) >= 50;
      },
      null,
      { timeout: 30 * 60_000, polling: 250 },
    )
    .then(() => page.screenshot({ path }))
    .then(() => path)
    .catch((err) => `none: ${String(err.message ?? err).split("\n")[0]}`);
}

/**
 * The screenshot once the transfer ended. A short transfer can pass half between two polls,
 * so after 2 s it gives up instead of waiting for the timeout of half an hour.
 */
function finishedShot(shot) {
  const late = new Promise((resolve) => setTimeout(resolve, 2000));
  return Promise.race([shot, late.then(() => "none: the transfer passed half between two polls")]);
}

/** Objects and multipart uploads this run left in a real bucket, then removed (--s3 env). */
async function realBucketCleanup(s3env, dataDir, since) {
  const s3 = createRequire(join(ROOT, "apps", "server", "package.json"))("@aws-sdk/client-s3");
  const Database = createRequire(join(ROOT, "apps", "server", "package.json"))("better-sqlite3");
  const client = new s3.S3Client({
    region: s3env.S3_REGION || "auto",
    endpoint: s3env.S3_ENDPOINT,
    forcePathStyle: s3env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: s3env.S3_ACCESS_KEY, secretAccessKey: s3env.S3_SECRET_KEY },
  });
  const Bucket = s3env.S3_BUCKET;
  const out = { multipartUploads: 0, parts: 0, deletedObjects: 0 };
  try {
    // Multipart uploads still open that this run started: their keys are uploads of this
    // server, and nothing else writes the bucket meanwhile. Counted first, then aborted.
    const listed = await client.send(new s3.ListMultipartUploadsCommand({ Bucket }));
    for (const upload of listed.Uploads ?? []) {
      if (!/^[0-9a-f-]{36}\.bin$/.test(upload.Key ?? "")) continue;
      if (!(upload.Initiated && upload.Initiated.getTime() >= since)) continue;
      const found = await client.send(
        new s3.ListPartsCommand({ Bucket, Key: upload.Key, UploadId: upload.UploadId }),
      );
      out.multipartUploads++;
      out.parts += found.Parts?.length ?? 0;
      await client.send(new s3.AbortMultipartUploadCommand({ Bucket, Key: upload.Key, UploadId: upload.UploadId }));
    }
    // The stored uploads of this run, by the IDs in its own database, and nothing else.
    const db = new Database(join(dataDir, "db", "skysend.db"), { readonly: true });
    const ids = db.prepare("SELECT id FROM uploads").all().map((row) => row.id);
    db.close();
    for (let i = 0; i < ids.length; i += 1000) {
      const Objects = ids.slice(i, i + 1000).map((id) => ({ Key: `${id}.bin` }));
      const deleted = await client.send(new s3.DeleteObjectsCommand({ Bucket, Delete: { Objects, Quiet: true } }));
      out.deletedObjects += Objects.length - (deleted.Errors?.length ?? 0);
    }
    return out;
  } catch (err) {
    return { ...out, error: String(err) };
  } finally {
    client.destroy();
  }
}

/** Nginx with the server block of the reverse proxy guide, in Docker, through e2e/scripts. */
async function startNginx() {
  const child = spawn(
    process.execPath,
    [join(ROOT, "e2e", "scripts", "nginx.mjs"), "bench", String(TLS_PORT), String(PORTS.proxyA)],
    { stdio: "ignore" },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  cleanups.push(async () => {
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  });
  const https = await import("node:https");
  for (let attempt = 0; attempt < 240; attempt++) {
    const up = await new Promise((resolve) => {
      https
        .get(`${ORIGIN}/api/health`, { rejectUnauthorized: false }, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        })
        .on("error", () => resolve(false));
    });
    if (up) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Nginx did not come up");
}

/** Multipart uploads still open in the bench bucket, and how many parts they hold. */
async function bucketLeftovers(store) {
  const s3 = createRequire(join(ROOT, "apps", "server", "package.json"))("@aws-sdk/client-s3");
  const client = new s3.S3Client({
    region: "us-east-1",
    endpoint: `http://${store.host}:${store.port}`,
    forcePathStyle: true,
    credentials: { accessKeyId: "bench", secretAccessKey: "bench" },
  });
  try {
    const listed = await client.send(new s3.ListMultipartUploadsCommand({ Bucket: BUCKET }));
    const uploads = listed.Uploads ?? [];
    let parts = 0;
    for (const upload of uploads) {
      const found = await client.send(
        new s3.ListPartsCommand({ Bucket: BUCKET, Key: upload.Key, UploadId: upload.UploadId }),
      );
      parts += found.Parts?.length ?? 0;
    }
    return { multipartUploads: uploads.length, parts };
  } catch (err) {
    return { error: String(err) };
  } finally {
    client.destroy();
  }
}

/** One upload and, unless --no-download, its download, with every step timed. */
async function singleTransfer(browser, source, result, sampler, counters) {
  // ── Upload ──────────────────────────────────────
  const sender = await browser.newContext({
    locale: "en-US",
    acceptDownloads: true,
    ignoreHTTPSErrors: true,
  });
  await sender.addInitScript(RECORDER);
  const page = await sender.newPage();
  const consoleLines = [];
  page.on("console", (message) => consoleLines.push(message.text()));
  // The reason the browser gives for a request that failed, which fetch() hides behind
  // "Failed to fetch".
  sender.on("requestfailed", (request) =>
    consoleLines.push(
      `requestfailed ${request.method()} ${request.url()} ${request.failure()?.errorText}`,
    ),
  );
  await page.goto(`${ORIGIN}/`);
  await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(source.paths);
  const uploadStart = Date.now();
  await page.getByRole("button", { name: "Encrypt and upload" }).click();
  const uploadShot = screenshotAtHalf(page, "upload");
  if (opts["cancel-after"]) {
    await page.waitForTimeout(Number(opts["cancel-after"]) * 1000);
    const events = await page.evaluate(() => window.__bench);
    await sender.close();
    result.upload = {
      cancelledAfterSeconds: Number(opts["cancel-after"]),
      reportedBytes: events.filter((e) => e.type === "progress").at(-1)?.loaded ?? 0,
    };
    return;
  }
  const linkBox = page.getByLabel("Share this link", { exact: true });
  // An upload that fails shows an error toast instead of the link, which would otherwise
  // leave this waiting for an hour.
  const toast = page.locator('[data-sonner-toast][data-type="error"]').first();
  const outcome = await Promise.race([
    linkBox.waitFor({ state: "visible", timeout: 60 * 60_000 }).then(() => "link"),
    toast.waitFor({ state: "visible", timeout: 60 * 60_000 }).then(() => "error"),
  ]);
  if (outcome === "error") {
    result.consoleLines = consoleLines.slice(-30);
    throw new Error(
      `The upload failed: ${await toast.textContent()}\n${consoleLines.slice(-15).join("\n")}`,
    );
  }
  const uploadEnd = Date.now();
  const link = (await linkBox.textContent()) ?? "";
  const events = await page.evaluate(() => window.__bench);
  const shownUpload = await page.evaluate(() => window.__shown);
  // The average the finished page shows, like "Ø 45.2 MB/s".
  const shownAverage = (await page.locator("main").innerText()).match(/Ø\s*[\d.]+\s*[KMG]?B\/s/)?.[0] ?? null;
  const closeStart = Date.now();
  await sender.close();
  const closeEnd = Date.now();

  const progress = events.filter((e) => e.type === "progress");
  const lastProgress = progress.at(-1);
  const firstProgress = progress[0];
  result.upload = {
    seconds: (uploadEnd - uploadStart) / 1000,
    mibPerSecond: Math.round((TOTAL / MIB / ((uploadEnd - uploadStart) / 1000)) * 10) / 10,
    transport: events.find((e) => e.type === "transport")?.transport,
    // From the click to the first byte the worker reports: keys, the socket, the session.
    startupSeconds: firstProgress ? (firstProgress.t - uploadStart) / 1000 : null,
    // From the last progress report to the link: what the server still did after the UI showed 100 %.
    tailSeconds: lastProgress ? (uploadEnd - lastProgress.t) / 1000 : null,
    progressEvents: progress.length,
  };
  // What the UI shows: the worker's reported bytes, in the same windows.
  const uiSamples = progress.map((e) => ({ t: e.t, ui: e.loaded }));
  result.upload.uiRate1s = stats(rates(uiSamples, "ui", uploadStart, uploadEnd, 1000));
  result.upload.uiRate500ms = stats(rates(uiSamples, "ui", uploadStart, uploadEnd, 500));
  result.upload.wireRate1s = stats(rates(sampler.samples, "aUp", uploadStart, uploadEnd, 1000));
  result.upload.wireRate250ms = stats(rates(sampler.samples, "aUp", uploadStart, uploadEnd, 250));
  if (counters.b)
    result.upload.s3Rate1s = stats(rates(sampler.samples, "bUp", uploadStart, uploadEnd, 1000));
  result.upload.cost = cost(sampler.samples, uploadStart, uploadEnd);
  // The progress the worker reported, as [time, bytes], for timeline.mjs.
  result.upload.shown = {
    ...shownSummary(shownUpload, uploadStart, uploadEnd, TOTAL / MIB / ((uploadEnd - uploadStart) / 1000)),
    average: shownAverage,
  };
  result.upload.screenshot = await finishedShot(uploadShot);
  result.upload.progress = progress.map((e) => [e.t, e.loaded]);
  result.upload.wireBytes = { a: counters.a.up, b: counters.b?.up };
  // TCP connections opened so far, to the server and to the bucket.
  result.upload.connections = { a: counters.a.connections, b: counters.b?.connections };

  // ── Download ────────────────────────────────────
  if (!opts["no-download"]) {
    const recipient = await browser.newContext({
      locale: "en-US",
      acceptDownloads: true,
      ignoreHTTPSErrors: true,
    });
    await recipient.addInitScript(RECORDER);
    const page2 = await recipient.newPage();
    const tiers = [];
    page2.on("console", (message) => {
      const tier = /Download tier: (\d)/.exec(message.text());
      if (tier) tiers.push(tier[1]);
    });
    const openStart = Date.now();
    await page2.goto(link);
    const loaded = Date.now();
    const button = page2.getByRole("button", { name: "Download", exact: true });
    await button.waitFor({ state: "visible" });
    const visible = Date.now();
    const downloadStart = Date.now();
    const started = page2.waitForEvent("download", { timeout: 10 * 60_000 });
    await button.click();
    const downloadShot = screenshotAtHalf(page2, "download");
    // WebKit is Safari to the app, which warns before a download over 256 MiB.
    const anyway = page2.getByRole("button", { name: "Download anyway" });
    const warned = await Promise.race([
      started.then(() => false),
      anyway.waitFor({ timeout: 10 * 60_000 }).then(() => true),
    ]);
    if (warned) await anyway.click();
    const download = await started;
    // A download that started but stalls, like one whose fetch the browser blocked, would
    // otherwise hold the run forever.
    let stall;
    const path = await Promise.race([
      download.path(),
      new Promise((_, reject) => {
        stall = setTimeout(
          () => reject(new Error("The download did not finish in 30 minutes")),
          30 * 60_000,
        );
      }),
    ]).finally(() => clearTimeout(stall));
    const downloadEnd = Date.now();
    const key = opts.storage === "s3" ? (counters.b ? "bDown" : null) : "aDown";
    // The page keeps showing the bar for a moment, and the average once it is done.
    await page2.waitForTimeout(1500);
    const shownDownload = await page2.evaluate(() => window.__shown);
    const shownDownloadAverage =
      (await page2.locator("main").innerText()).match(/Ø\s*[\d.]+\s*[KMG]?B\/s/)?.[0] ?? null;
    result.download = {
      seconds: (downloadEnd - downloadStart) / 1000,
      mibPerSecond: Math.round((TOTAL / MIB / ((downloadEnd - downloadStart) / 1000)) * 10) / 10,
      // Closing the sender, loading the link and the Download button showing up.
      steps: {
        closeSender: (closeEnd - closeStart) / 1000,
        loadPage: (loaded - openStart) / 1000,
        buttonVisible: (visible - loaded) / 1000,
      },
      tiers,
      wireRate1s: key ? stats(rates(sampler.samples, key, downloadStart, downloadEnd, 1000)) : null,
      shown: {
        ...shownSummary(
          shownDownload,
          downloadStart,
          downloadEnd,
          TOTAL / MIB / ((downloadEnd - downloadStart) / 1000),
        ),
        average: shownDownloadAverage,
      },
      screenshot: await finishedShot(downloadShot),
      cost: cost(sampler.samples, downloadStart, downloadEnd),
    };
    if (!opts["no-verify"]) result.download.intact = await downloadIntact(path, source);
    await download.delete();
    await recipient.close();
  }
}

/** Runs the CLI with --json and returns what it printed, with the times it started and ended. */
function runCli(args, home) {
  const start = Date.now();
  return new Promise((resolveRun, reject) => {
    const child = spawn(resolve(ROOT, opts["cli-bin"]), [...args, "--json"], {
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, "config"),
        // The Nginx of --proxy has a self-signed certificate.
        ...(opts.proxy ? { NODE_TLS_REJECT_UNAUTHORIZED: "0" } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60 * 60_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      const end = Date.now();
      if (code !== 0) {
        reject(new Error(`skysend ${args[0]} exited with ${code}: ${stderr.slice(-2000)}`));
        return;
      }
      resolveRun({ json: JSON.parse(stdout.trim().split("\n").at(-1)), start, end });
    });
  });
}

/**
 * One upload and its download with the CLI. The CLI is a child of this process like a browser,
 * so the sampler counts its CPU and memory where it counts the browser's.
 */
async function cliTransfer(source, result, sampler, counters) {
  const home = join(WORK, "cli-home");
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const firstByte = (key, from, before) =>
    sampler.samples.find((s) => s.t >= from && s[key] > before)?.t;
  const mibPerSecond = (from, to) => Math.round((TOTAL / MIB / ((to - from) / 1000)) * 10) / 10;

  const sentBefore = counters.a.up;
  const noWs = opts.transport === "http" ? ["--no-ws"] : [];
  const up = await runCli(["upload", ...source.paths, "--server", ORIGIN, ...noWs], home);
  const firstUp = firstByte("aUp", up.start, sentBefore);
  result.upload = {
    transport: up.json.transport,
    seconds: (up.end - up.start) / 1000,
    mibPerSecond: mibPerSecond(up.start, up.end),
    // From the start of the process to the first byte on the wire: startup, keys, the session.
    startupSeconds: firstUp ? (firstUp - up.start) / 1000 : null,
    wireRate1s: stats(rates(sampler.samples, "aUp", up.start, up.end, 1000)),
    wireRate250ms: stats(rates(sampler.samples, "aUp", up.start, up.end, 250)),
    s3Rate1s: counters.b ? stats(rates(sampler.samples, "bUp", up.start, up.end, 1000)) : undefined,
    cost: cost(sampler.samples, up.start, up.end),
    wireBytes: { a: counters.a.up, b: counters.b?.up },
    connections: { a: counters.a.connections, b: counters.b?.connections },
  };

  if (opts["no-download"]) return;
  const down = await runCli(["download", up.json.url, "--output", join(WORK, "downloads")], home);
  const key = opts.storage === "s3" ? (counters.b ? "bDown" : null) : "aDown";
  result.download = {
    seconds: (down.end - down.start) / 1000,
    mibPerSecond: mibPerSecond(down.start, down.end),
    wireRate1s: key ? stats(rates(sampler.samples, key, down.start, down.end, 1000)) : null,
    cost: cost(sampler.samples, down.start, down.end),
  };
  if (!opts["no-verify"]) result.download.intact = await downloadIntact(down.json.file, source);
  rmSync(down.json.file, { force: true });
}

/** The channel a browser is launched with: the full Chromium unless --channel says otherwise. */
function launchChannel() {
  if (opts.executable) return undefined;
  const channel = opts.channel ?? (opts.browser === "chromium" ? "chromium" : undefined);
  return channel && channel !== "shell" ? channel : undefined;
}

/** How a browser of this run is launched, for the main one and the --separate ones alike. */
function launchOptions() {
  const channel = launchChannel();
  return {
    downloadsPath: join(WORK, "downloads"),
    // Chromium refuses a Service Worker from an origin with a certificate error unless the
    // whole browser ignores such errors, see e2e/CLAUDE.md.
    ...(opts.proxy && opts.browser === "chromium" ? { args: ["--ignore-certificate-errors"] } : {}),
    ...(channel ? { channel } : {}),
    ...(opts.executable ? { executablePath: opts.executable } : {}),
  };
}

/** Shares the file through the UI of a fresh context and returns the link. */
async function shareOnce(browser, source) {
  const context = await browser.newContext({ locale: "en-US", ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(source.path);
  await page.getByRole("button", { name: "Encrypt and upload" }).click();
  const box = page.getByLabel("Share this link", { exact: true });
  await box.waitFor({ timeout: 60 * 60_000 });
  const link = (await box.textContent()) ?? "";
  await context.close();
  return link;
}

/** Jain's fairness index of rates: 1 when all are equal, 1/n when one gets everything. */
function fairness(rates) {
  if (rates.length < 2) return null;
  const sum = rates.reduce((a, b) => a + b, 0);
  const squares = rates.reduce((a, b) => a + b * b, 0);
  return squares === 0 ? null : Math.round(((sum * sum) / (rates.length * squares)) * 100) / 100;
}

/**
 * Runs `uploads` uploads and `downloads` downloads at the same time and records, per transfer,
 * its time and its speed while all of them ran, and how evenly they shared.
 */
async function mixedTransfers(browser, source, uploads, downloads, result, sampler) {
  // The files to download, shared one by one before anything is measured.
  const links = [];
  for (let i = 0; i < downloads; i++) links.push(await shareOnce(browser, source));
  const idOf = (link) => /\/file\/([0-9a-f]{8})/.exec(link)?.[1];

  // A context of the shared browser, or of a browser of its own with --separate.
  const contextFor = async (options) => {
    if (!opts.separate) return browser.newContext(options);
    const own = await engine.launch(launchOptions());
    cleanups.push(() => own.close());
    return own.newContext(options);
  };

  // Every page is ready first, so all transfers start together instead of when their page loaded.
  const prepared = await Promise.all([
    ...Array.from({ length: uploads }, async (_, index) => {
      const context = await contextFor({ locale: "en-US", ignoreHTTPSErrors: true });
      await context.addInitScript(RECORDER);
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/`);
      await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(source.path);
      const button = page.getByRole("button", { name: "Encrypt and upload" });
      await button.waitFor();
      return { kind: "upload", name: `upload ${index + 1}`, context, page, button };
    }),
    ...links.map(async (link, index) => {
      const context = await contextFor({
        locale: "en-US",
        acceptDownloads: true,
        ignoreHTTPSErrors: true,
      });
      const page = await context.newPage();
      await page.goto(link);
      const button = page.getByRole("button", { name: "Download", exact: true });
      await button.waitFor();
      return {
        kind: "download",
        name: `download ${index + 1}`,
        label: `down:${idOf(link)}`,
        context,
        page,
        button,
      };
    }),
  ]);
  if (opts["drop-caches"]) {
    // The files come from the disk then, not from memory.
    execFileSync("sudo", ["sh", "-c", "sync; echo 3 > /proc/sys/vm/drop_caches"]);
  }

  const start = Date.now();
  const runs = prepared.map(async ({ kind, name, label, context, page, button }) => {
    const began = Date.now();
    if (kind === "upload") {
      await button.click();
      const toast = page.locator('[data-sonner-toast][data-type="error"]').first();
      const outcome = await Promise.race([
        page
          .getByLabel("Share this link", { exact: true })
          .waitFor({ timeout: 60 * 60_000 })
          .then(() => "link"),
        toast.waitFor({ timeout: 60 * 60_000 }).then(() => "error"),
      ]);
      if (outcome === "error") throw new Error(`An upload failed: ${await toast.textContent()}`);
      const ended = Date.now();
      const events = await page.evaluate(() => window.__bench);
      await context.close();
      const progress = events.filter((e) => e.type === "progress").map((e) => [e.t, e.loaded]);
      return { kind, name, began, ended, progress };
    }
    const started = page.waitForEvent("download", { timeout: 10 * 60_000 });
    await button.click();
    const anyway = page.getByRole("button", { name: "Download anyway" });
    const warned = await Promise.race([
      started.then(() => false),
      anyway.waitFor({ timeout: 10 * 60_000 }).then(() => true),
    ]);
    if (warned) await anyway.click();
    const download = await started;
    const path = await download.path();
    const ended = Date.now();
    const intact = opts["no-verify"] ? undefined : (await hashFile(path)) === source.sha256;
    await download.delete();
    await context.close();
    return { kind, name, label, began, ended, intact };
  });
  const transfers = await Promise.all(runs);
  const end = Date.now();

  // The window in which every transfer ran, which is where sharing shows.
  const from = Math.max(...transfers.map((t) => t.began)) + 1000;
  const to = Math.min(...transfers.map((t) => t.ended)) - 500;
  const at = (time) =>
    sampler.samples.reduce((best, s) => (s.t <= time ? s : best), sampler.samples[0]);
  const bytesAt = (transfer, time) => {
    if (transfer.kind === "upload") {
      let bytes = 0;
      for (const [t, loaded] of transfer.progress) if (t <= time) bytes = loaded;
      return bytes;
    }
    return at(time).labels[transfer.label]?.down ?? 0;
  };
  const seconds = (to - from) / 1000;
  for (const transfer of transfers) {
    transfer.seconds = (transfer.ended - transfer.began) / 1000;
    transfer.mibPerSecond = Math.round((SIZE / MIB / transfer.seconds) * 10) / 10;
    transfer.whileAllRan =
      seconds > 1
        ? Math.round(((bytesAt(transfer, to) - bytesAt(transfer, from)) / MIB / seconds) * 10) / 10
        : null;
    delete transfer.progress;
  }
  const rates = (kind) =>
    transfers.filter((t) => !kind || t.kind === kind).map((t) => t.whileAllRan ?? 0);
  const first = at(start);
  const last = at(end);
  const span = (last.t - first.t) / 1000;
  result.mixed = {
    uploads,
    downloads,
    seconds: (end - start) / 1000,
    overlapSeconds: Math.round(seconds * 10) / 10,
    transfers,
    fairness: {
      uploads: fairness(rates("upload")),
      downloads: fairness(rates("download")),
      all: fairness(rates()),
    },
    totalWhileAllRan: Math.round(rates().reduce((a, b) => a + b, 0) * 10) / 10,
    disk: {
      device: DEVICE,
      readMibPerSecond: Math.round(((last.diskRead - first.diskRead) / MIB / span) * 10) / 10,
      writtenMibPerSecond:
        Math.round(((last.diskWritten - first.diskWritten) / MIB / span) * 10) / 10,
    },
    cost: cost(sampler.samples, start, end),
  };
}

/** Uploads the file from `count` senders at once and records time and cost of all of them. */
async function parallelUploads(browser, source, count, result, sampler) {
  const start = Date.now();
  const ends = await Promise.all(
    Array.from({ length: count }, async () => {
      const context = await browser.newContext({ locale: "en-US", ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/`);
      await page.locator('input[type="file"]:not([webkitdirectory])').setInputFiles(source.path);
      await page.getByRole("button", { name: "Encrypt and upload" }).click();
      const toast = page.locator('[data-sonner-toast][data-type="error"]').first();
      const outcome = await Promise.race([
        page
          .getByLabel("Share this link", { exact: true })
          .waitFor({ timeout: 60 * 60_000 })
          .then(() => "link"),
        toast.waitFor({ timeout: 60 * 60_000 }).then(() => "error"),
      ]);
      if (outcome === "error") throw new Error(`An upload failed: ${await toast.textContent()}`);
      const end = Date.now();
      await context.close();
      return end;
    }),
  );
  const end = Math.max(...ends);
  result.parallel = {
    count,
    seconds: (end - start) / 1000,
    totalMibPerSecond: Math.round(((count * SIZE) / MIB / ((end - start) / 1000)) * 10) / 10,
    wireRate1s: stats(rates(sampler.samples, "aUp", start, end, 1000)),
    cost: cost(sampler.samples, start, end),
  };
}

async function main() {
  const source = await sourceFiles(SIZE, FILES);
  const counters = { a: null, b: null };
  let storageEnv = {};
  let store = null;
  const realBucket = opts.storage === "s3" && opts.s3 === "env";
  if (realBucket) {
    // A real provider signs its requests for its own host, so no counter sits in between.
    storageEnv = s3FromEnvFile(opts["s3-env"]);
  } else if (opts.storage === "s3") {
    store = await startS3();
    counters.b = await countingProxy(PORTS.proxyB, store.host, store.port);
    storageEnv = {
      STORAGE_BACKEND: "s3",
      S3_BUCKET: BUCKET,
      S3_REGION: "us-east-1",
      S3_ENDPOINT: `http://127.0.0.1:${PORTS.proxyB}`,
      S3_ACCESS_KEY: "bench",
      S3_SECRET_KEY: "bench",
      S3_FORCE_PATH_STYLE: "true",
    };
  }
  const runStart = Date.now();
  const server = startServer(storageEnv);
  let bucketCleaned = null;
  const cleanBucket = () => {
    bucketCleaned ??= new Promise((resolve) => setTimeout(resolve, 3000)).then(() =>
      realBucketCleanup(storageEnv, join(WORK, "data"), runStart - 5000),
    );
    return bucketCleaned;
  };
  if (realBucket) {
    cleanups.push(async () => {
      console.log(`[bench] left in the bucket and removed: ${JSON.stringify(await cleanBucket())}`);
    });
  }
  serverForErrors = server;
  counters.a = await countingProxy(PORTS.proxyA, "127.0.0.1", PORTS.server);
  await waitFor(`http://127.0.0.1:${PORTS.server}/api/health`, "The server");
  if (opts.proxy) await startNginx();

  const downloads = join(WORK, "downloads");
  rmSync(downloads, { recursive: true, force: true });
  mkdirSync(downloads, { recursive: true });
  cleanups.push(() => rmSync(downloads, { recursive: true, force: true }));
  const channel = CLI ? undefined : launchChannel();
  const browser = CLI
    ? null
    : await engine.launch({ ...launchOptions(), downloadsPath: downloads });
  if (browser) cleanups.push(() => browser.close());
  const sampler = startSampler(counters, server.child.pid);

  const result = {
    label,
    client: opts.client,
    browser: CLI ? undefined : opts.browser,
    channel,
    version: CLI
      ? execFileSync(resolve(ROOT, opts["cli-bin"]), ["--version"]).toString().trim()
      : browser.version(),
    files: FILES,
    storage: opts.storage,
    s3: opts.storage === "s3" ? opts.s3 : undefined,
    executable: opts.executable,
    transport: opts.transport,
    sizeMiB: SIZE / MIB,
    env: opts.env,
    startedAt: new Date().toISOString(),
  };
  try {
    if (opts.uploads || opts.downloads) {
      const uploads = Number(opts.uploads ?? 0);
      await mixedTransfers(browser, source, uploads, Number(opts.downloads ?? 0), result, sampler);
    } else if (Number(opts.parallel) > 1)
      await parallelUploads(browser, source, Number(opts.parallel), result, sampler);
    else if (CLI) await cliTransfer(source, result, sampler, counters);
    else await singleTransfer(browser, source, result, sampler, counters);
  } finally {
    sampler.stop();
    result.samples = sampler.samples;
    // Drops the request log lines. startsWith, since CodeQL reads /^-->/ as HTML filtering.
    const notRequest = (line) => !line.startsWith("<--") && !line.startsWith("-->");
    result.serverLog = server.log.filter(notRequest).slice(-50);
    await browser?.close().catch(() => {});
    // Aborts run after the socket closed, so the cleanup gives them a moment first.
    if (realBucket) result.s3Leftovers = await cleanBucket();
    if (store) {
      // What a run leaves in the bucket. A multipart upload that was never completed or
      // aborted keeps its parts, which a provider bills until a lifecycle rule removes them.
      // Aborts run after the socket closed, so they get a moment first.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      result.s3Leftovers = await bucketLeftovers(store);
      console.log(`[bench] left in the bucket: ${JSON.stringify(result.s3Leftovers)}`);
    }
    await cleanup();
  }

  const resultsDir = join(WORK, "results");
  mkdirSync(resultsDir, { recursive: true });
  const file = join(resultsDir, `${label}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  const { samples: _samples, serverLog, ...summary } = result;
  if (summary.upload) summary.upload = { ...summary.upload, progress: undefined };
  console.log(JSON.stringify(summary, null, 2));
  if (serverLog.some((line) => /error|failed/i.test(line)))
    console.log("server log:\n" + serverLog.join("\n"));
  console.log(`[bench] ${file}`);
  if (result.download && result.download.intact === false) {
    console.error("[bench] The download differs from the upload");
    process.exitCode = 1;
  }
}

let serverForErrors = null;
main().catch(async (err) => {
  console.error(err);
  if (serverForErrors) console.error("server log:\n" + serverForErrors.log.slice(-40).join("\n"));
  await cleanup();
  process.exit(1);
});
