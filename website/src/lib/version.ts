import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const RootPackageSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) });

/**
 * The version of the release, read at build time from the package.json at the
 * root of the monorepo, which `pnpm version:bump` keeps current. Null when the
 * build runs without the rest of the repository.
 */
export function getReleaseVersion(): string | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "..", "package.json"), "utf8");
    const parsed = RootPackageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? `v${parsed.data.version}` : null;
  } catch {
    return null;
  }
}
