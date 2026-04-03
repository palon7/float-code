import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BrowseEntry } from "@float-code/shared/protocol";
import { WorkspaceNotFoundError } from "./errors.js";

const EXCLUDED_NAMES = new Set(["node_modules"]);

export async function browseDirectory(dirPath: string): Promise<BrowseEntry[]> {
  const resolved = path.resolve(dirPath);

  let dirents;
  try {
    dirents = await fs.readdir(resolved, { withFileTypes: true });
  } catch {
    throw new WorkspaceNotFoundError(resolved);
  }

  return dirents
    .filter(
      (d) =>
        d.isDirectory() &&
        !d.name.startsWith(".") &&
        !EXCLUDED_NAMES.has(d.name),
    )
    .map((d) => ({ name: d.name, path: path.join(resolved, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
