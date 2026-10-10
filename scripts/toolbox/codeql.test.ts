import { describe, expect, it } from "vitest";
import { describeScan, newAlerts, pendingLanguages, scanDev } from "./codeql.mjs";

const HEAD = "b3d73bb5000000000000000000000000000000aa";
const OLD = "1df92f69000000000000000000000000000000bb";

function alert(number: number) {
  return {
    number,
    html_url: `https://github.com/Skyfay/SkySend/security/code-scanning/${number}`,
    rule: { id: "js/regex-injection", description: "Regular expression injection", security_severity_level: "high" },
    most_recent_instance: { location: { path: "scripts/changelog.mjs", start_line: 339 } },
  };
}

describe("the CodeQL alerts a release would bring to main", () => {
  it("leaves out alerts that main has open already", () => {
    expect(newAlerts([alert(1), alert(2)], [alert(1)]).map((a) => a.number)).toEqual([2]);
  });

  it("waits for the language whose latest analysis is of an older commit", () => {
    const analyses = [
      { category: "/language:actions", commit_sha: HEAD, created_at: "2026-10-10T12:05:00Z" },
      { category: "/language:javascript-typescript", commit_sha: OLD, created_at: "2026-10-10T11:52:00Z" },
      { category: "/language:actions", commit_sha: OLD, created_at: "2026-10-10T11:50:00Z" },
    ];
    expect(pendingLanguages(analyses, HEAD)).toEqual(["javascript-typescript"]);
  });

  it("counts the scan as finished once every language has analysed the latest commit", () => {
    const analyses = [
      { category: "/language:javascript-typescript", commit_sha: HEAD, created_at: "2026-10-10T12:07:00Z" },
      { category: "/language:actions", commit_sha: HEAD, created_at: "2026-10-10T12:05:00Z" },
    ];
    expect(pendingLanguages(analyses, HEAD)).toEqual([]);
  });

  it("does not count a branch without any analysis as clean", () => {
    expect(pendingLanguages([], HEAD)).toEqual(["no analysis yet"]);
  });

  it("asks git and GitHub and keeps only the alerts that are new for main", () => {
    const calls: string[] = [];
    const scan = scanDev({
      run: (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (args[0] === "rev-parse") return HEAD;
        if (args[0] === "rev-list") return "0";
        if (command === "git") return "";
        const endpoint = args[1];
        if (endpoint.includes("/analyses")) {
          return JSON.stringify([{ category: "/language:javascript-typescript", commit_sha: HEAD, created_at: "2026-10-10T12:07:00Z" }]);
        }
        return JSON.stringify(endpoint.includes("refs/heads/dev") ? [alert(36), alert(12)] : [alert(12)]);
      },
    });
    expect(scan).toMatchObject({ head: HEAD, unpushed: 0, pending: [] });
    expect(scan.alerts.map((a) => a.number)).toEqual([36]);
    expect(calls).toContain("git fetch --quiet origin dev");
  });
});

describe("what the check says", () => {
  it("says nothing about a clean and finished scan", () => {
    expect(describeScan({ head: HEAD, unpushed: 0, alerts: [], pending: [] })).toEqual([]);
  });

  it("names every alert with its place and link, and commits CodeQL has not seen", () => {
    const lines = describeScan({ head: HEAD, unpushed: 2, alerts: [alert(36)], pending: ["actions"] });
    expect(lines.join("\n")).toContain("has not finished dev at b3d73bb yet (actions)");
    expect(lines.join("\n")).toContain("2 commits are not pushed to dev yet");
    expect(lines.join("\n")).toContain("#36 [high] Regular expression injection");
    expect(lines.join("\n")).toContain("scripts/changelog.mjs:339  https://github.com/Skyfay/SkySend/security/code-scanning/36");
  });
});
