// Prints one line per run of transfer.mjs, so runs side by side compare at a glance.
//
//   node e2e/bench/summary.mjs [--last 5] [result.json ...]
//
// Without files it takes the newest results in e2e/.large-files/bench/results.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { last: { type: "string", default: "1" } },
});
const dir = join(import.meta.dirname, "..", ".large-files", "bench", "results");
const files =
  positionals.length > 0
    ? positionals
    : readdirSync(dir)
        .map((name) => join(dir, name))
        .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
        .slice(-Number(values.last));

for (const file of files) {
  const r = JSON.parse(readFileSync(file, "utf8"));
  if (r.mixed) {
    const m = r.mixed;
    console.log(
      `run=${r.label}  ${m.uploads} up + ${m.downloads} down  secs=${m.seconds}  overlap=${m.overlapSeconds}s  ` +
        `total while all ran=${m.totalWhileAllRan}  fair up=${m.fairness.uploads} down=${m.fairness.downloads} all=${m.fairness.all}  ` +
        `disk r=${m.disk.readMibPerSecond} w=${m.disk.writtenMibPerSecond}  srv MiB=${m.cost?.serverPeakRssMiB} cpu=${m.cost?.serverCpuPercent} main=${m.cost?.serverMainThreadPercent}`,
    );
    for (const t of m.transfers) {
      const ok = t.intact === undefined ? "" : `  intact=${t.intact}`;
      console.log(
        `    ${t.name.padEnd(11)} ${t.mibPerSecond} MiB/s over ${t.seconds}s, ${t.whileAllRan} while all ran${ok}`,
      );
    }
    continue;
  }
  const u = r.upload ?? {};
  const d = r.download ?? {};
  const p = r.parallel;
  const fields = {
    run: r.label,
    env: r.env?.length ? r.env.join(" ") : undefined,
    up: p ? p.totalMibPerSecond : u.mibPerSecond,
    secs: p ? p.seconds : u.seconds,
    start: u.startupSeconds,
    tail: u.tailSeconds,
    "ui cv": u.uiRate1s?.cv,
    "wire cv": u.wireRate250ms?.cv,
    stalls: u.wireRate250ms?.stalls,
    "s3 cv": u.s3Rate1s?.cv,
    down: d.mibPerSecond,
    intact: d.intact,
    "srv MiB": (p ?? u).cost?.serverPeakRssMiB,
    "srv cpu": (p ?? u).cost?.serverCpuPercent,
    // The browser or the CLI, whichever ran: its peak memory while sending and while receiving.
    "client MiB": u.cost?.browserPeakRssMiB,
    "client down MiB": d.cost?.browserPeakRssMiB,
    "client cpu": u.cost?.browserCpuPercent,
    left: r.s3Leftovers ? `${r.s3Leftovers.multipartUploads}/${r.s3Leftovers.parts}` : undefined,
  };
  console.log(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${value}`)
      .join("  "),
  );
}
