import { describe, expect, it } from "vitest";
import { VERSION, clientVersion, dockerTags, nextVersion, withVersion } from "./version.mjs";

describe("the next version", () => {
  it("counts up a released version", () => {
    expect(nextVersion("4.0.1", "patch")).toBe("4.0.2");
    expect(nextVersion("4.0.1", "minor")).toBe("4.1.0");
    expect(nextVersion("4.0.1", "major")).toBe("5.0.0");
  });

  it("turns a preview into the release it previews, the way npm does", () => {
    expect(nextVersion("4.1.0-beta", "patch")).toBe("4.1.0");
    expect(nextVersion("4.1.0-beta", "minor")).toBe("4.1.0");
    expect(nextVersion("5.0.0-beta", "major")).toBe("5.0.0");
    expect(nextVersion("4.1.2-beta", "minor")).toBe("4.2.0");
  });

  it("refuses something that is no version", () => {
    expect(() => nextVersion("latest", "patch")).toThrow(/Not a version/);
  });

  it("accepts a custom version with a suffix and refuses one without three numbers", () => {
    expect(VERSION.test("4.1.0-beta")).toBe(true);
    expect(VERSION.test("4.1")).toBe(false);
    expect(VERSION.test("v4.1.0")).toBe(false);
  });
});

describe("the Docker tags of a version", () => {
  it("tags a release as latest and its major version", () => {
    expect(dockerTags("4.0.1")).toBe("`latest`, `v4`");
  });

  it("tags a beta and a dev build with their channel only", () => {
    expect(dockerTags("4.1.0-beta")).toBe("`beta`");
    expect(dockerTags("4.1.0-dev")).toBe("`dev`");
  });
});

describe("writing the version", () => {
  it("changes only the version of package.json and keeps its formatting", () => {
    const json = '{\n    "name": "skysend",\n    "version": "4.0.0",\n    "dependencies": { "x": "1.0.0" }\n}\n';
    expect(withVersion(json, "4.0.1")).toBe(json.replace('"version": "4.0.0"', '"version": "4.0.1"'));
  });

  it("writes the version the CLI client compiles in", () => {
    expect(clientVersion("3.0.1")).toBe(
      '// Auto-synced by scripts/toolbox/version.mjs - do not edit manually\nexport const APP_VERSION = "3.0.1";\n',
    );
  });
});
