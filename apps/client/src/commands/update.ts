import * as fs from "node:fs";
import * as os from "node:os";
import type { Command } from "commander";
import { writeLine } from "../lib/progress.js";
import { APP_VERSION } from "../version.js";

function getCurrentVersion(): string {
  return APP_VERSION;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const res = await fetch(
    "https://api.github.com/repos/skyfay/SkySend/releases/latest",
    { headers: { "User-Agent": "skysend-cli", Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as GithubRelease;
}

function getPlatform(): string {
  const platform = os.platform();
  const arch = os.arch();

  let osName: string;
  switch (platform) {
    case "linux":  osName = "linux"; break;
    case "darwin": osName = "macos"; break;
    case "win32":  osName = "windows"; break;
    default: throw new Error(`Unsupported platform: ${platform}`);
  }

  let archName: string;
  switch (arch) {
    case "x64":   archName = "x64"; break;
    case "arm64": archName = "arm64"; break;
    default: throw new Error(`Unsupported architecture: ${arch}`);
  }

  return `${osName}-${archName}`;
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Check for updates and self-update the CLI binary")
    .option("--check", "Only check for updates without installing")
    .action(async (opts: { check?: boolean }) => {
      const currentVersion = getCurrentVersion();
      writeLine(`Current version: v${currentVersion}`);

      let release: GithubRelease;
      try {
        release = await fetchLatestRelease();
      } catch (err) {
        console.error(
          `Error checking for updates: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      const latestVersion = release.tag_name.replace(/^v/, "");
      if (compareVersions(latestVersion, currentVersion) <= 0) {
        writeLine(`Already up to date (v${currentVersion}).`);
        return;
      }

      writeLine(`New version available: v${latestVersion}`);
      writeLine(`Release: ${release.html_url}`);

      if (opts.check) {
        return;
      }

      // Find the correct asset for this platform
      const platform = getPlatform();
      const assetName =
        platform === "windows-x64" ? `skysend-${platform}.exe` : `skysend-${platform}`;
      const asset = release.assets.find((a) => a.name === assetName);

      if (!asset) {
        console.error(
          `No binary found for ${platform}. Available assets: ${release.assets.map((a) => a.name).join(", ")}`,
        );
        process.exit(1);
      }

      writeLine(`Downloading ${assetName}...`);

      // Download the new binary
      const res = await fetch(asset.browser_download_url, {
        headers: { "User-Agent": "skysend-cli" },
        redirect: "follow",
      });
      if (!res.ok || !res.body) {
        console.error(`Download failed: ${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const data = new Uint8Array(await res.arrayBuffer());

      // Verify checksum if available
      const checksumAsset = release.assets.find((a) => a.name === "checksums.txt");
      if (checksumAsset) {
        try {
          const csRes = await fetch(checksumAsset.browser_download_url, {
            headers: { "User-Agent": "skysend-cli" },
            redirect: "follow",
          });
          if (csRes.ok) {
            const csText = await csRes.text();
            const line = csText.split("\n").find((l) => l.includes(assetName));
            if (line) {
              const expected = line.split(/\s+/)[0]!;
              const hashBuffer = await crypto.subtle.digest("SHA-256", data);
              const actual = Array.from(new Uint8Array(hashBuffer))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
              if (expected !== actual) {
                console.error("Checksum mismatch! Aborting update.");
                console.error(`  Expected: ${expected}`);
                console.error(`  Actual:   ${actual}`);
                process.exit(1);
              }
              writeLine("Checksum verified.");
            }
          }
        } catch {
          // Non-fatal: proceed without checksum verification
        }
      }

      // Replace the current binary
      const execPath = process.execPath;
      const tmpPath = `${execPath}.update`;

      try {
        fs.writeFileSync(tmpPath, data);
        fs.chmodSync(tmpPath, 0o755);

        // Atomic replace: rename new over old
        fs.renameSync(tmpPath, execPath);
        writeLine(`Updated to v${latestVersion}.`);
      } catch (err) {
        // Clean up temp file on failure
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore
        }

        if (
          err instanceof Error &&
          ("code" in err) &&
          ((err as NodeJS.ErrnoException).code === "EACCES" ||
            (err as NodeJS.ErrnoException).code === "EPERM")
        ) {
          console.error(
            "Permission denied. Try running with sudo or re-run the install script.",
          );
        } else {
          console.error(
            `Update failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        process.exit(1);
      }
    });
}
