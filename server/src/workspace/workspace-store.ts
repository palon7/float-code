import { realpath } from "node:fs/promises";
import * as path from "node:path";
import {
  readJsonSafe,
  writeJsonAtomic,
  ensureDir,
  dataPath,
} from "../utils/fs.js";
import type { WorkspaceInfo } from "@float-code/shared/protocol";

type RecentEntry = {
  path: string;
  lastUsedAt: string;
};

type WorkspacesData = {
  version: 1;
  recent: RecentEntry[];
};

const MAX_RECENT = 20;
const STORE_PATH = dataPath("workspaces.json");

const DEFAULT_DATA: WorkspacesData = {
  version: 1,
  recent: [],
};

async function load(): Promise<WorkspacesData> {
  return readJsonSafe<WorkspacesData>(STORE_PATH, DEFAULT_DATA);
}

async function save(data: WorkspacesData): Promise<void> {
  await ensureDir(path.dirname(STORE_PATH));
  await writeJsonAtomic(STORE_PATH, data);
}

export async function getRecent(): Promise<WorkspaceInfo[]> {
  const data = await load();
  return data.recent
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .map((entry) => ({
      path: entry.path,
      name: path.basename(entry.path),
      lastUsedAt: entry.lastUsedAt,
    }));
}

export async function touchRecent(absolutePath: string): Promise<void> {
  const resolved = await realpath(absolutePath);
  const data = await load();
  const now = new Date().toISOString();

  data.recent = data.recent.filter((e) => e.path !== resolved);
  data.recent.unshift({ path: resolved, lastUsedAt: now });

  if (data.recent.length > MAX_RECENT) {
    data.recent = data.recent.slice(0, MAX_RECENT);
  }

  await save(data);
}
