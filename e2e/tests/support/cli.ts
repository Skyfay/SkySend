import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const CLIENT = join(import.meta.dirname, "..", "..", "..", "apps", "client", "dist");

/**
 * The end-user CLI: as `pnpm test:e2e:build` builds it, run with Node, or with
 * E2E_CLI=binary the Bun binary of `pnpm client:compile`, which is what people install.
 */
function command(args: string[]): [string, string[]] {
  return process.env.E2E_CLI === "binary"
    ? [join(CLIENT, "skysend"), args]
    : [process.execPath, [join(CLIENT, "index.js"), ...args]];
}

/** Config and history of the CLI go into `home`, a folder of the test. */
function envFor(home: string, extra: Record<string, string> = {}) {
  return { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, "config"), ...extra };
}

/**
 * Runs a command of the CLI with `--json` and returns what it printed. Its config and history go
 * into `home`, a folder of the test, never into the config of whoever runs the tests.
 */
export async function cli(args: string[], home: string) {
  const [file, argv] = command([...args, "--json"]);
  const { stdout } = await promisify(execFile)(file, argv, { env: envFor(home), timeout: 60_000 });
  return JSON.parse(stdout) as Record<string, unknown>;
}

/**
 * Runs a command of the CLI that logs in through the browser: hands the login address it prints
 * to `login`, which plays the browser, then returns the JSON it printed. The stand-in for
 * xdg-open on the PATH opens nothing, so no real browser starts.
 */
export async function cliWithLogin(
  args: string[],
  home: string,
  login: (url: string) => Promise<void>,
) {
  const bin = join(home, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "xdg-open"), "#!/bin/sh\nexit 0\n");
  await chmod(join(bin, "xdg-open"), 0o755);
  const [file, argv] = command([...args, "--json"]);
  const child = spawn(file, argv, { env: envFor(home, { PATH: `${bin}:${process.env.PATH}` }) });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No login address within 30 s:\n${stderr}`)),
      30_000,
    );
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      const found = /Opening browser for login: (\S+)/.exec(stderr);
      if (found) {
        clearTimeout(timer);
        resolve(found[1]!);
      }
    });
  });
  await login(url);
  const code = await exited;
  if (code !== 0) throw new Error(`The CLI ended with ${code}:\n${stderr}`);
  return JSON.parse(stdout) as Record<string, unknown>;
}
