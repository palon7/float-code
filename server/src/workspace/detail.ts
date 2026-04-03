import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import * as path from "node:path";
import type {
  GitInfo,
  WorkspaceDetailResponse,
} from "@float-code/shared/protocol";
import { WorkspaceNotFoundError } from "./errors.js";

const GIT_TIMEOUT = 5_000;
const GIT_MAX_BUFFER = 256 * 1024;

function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; ok: boolean }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: GIT_TIMEOUT, maxBuffer: GIT_MAX_BUFFER },
      (err, stdout) => {
        resolve({ stdout: stdout.trim(), ok: !err });
      },
    );
  });
}

async function getGitInfo(dirPath: string): Promise<GitInfo | undefined> {
  const [rev, branch, status] = await Promise.all([
    git(dirPath, ["rev-parse", "--is-inside-work-tree"]),
    git(dirPath, ["branch", "--show-current"]),
    git(dirPath, ["status", "--porcelain"]),
  ]);

  if (!rev.ok || rev.stdout !== "true") return undefined;

  return {
    branch: branch.stdout || "HEAD",
    dirty: status.stdout.length > 0,
  };
}

export async function getWorkspaceDetail(
  dirPath: string,
): Promise<WorkspaceDetailResponse> {
  const resolved = path.resolve(dirPath);

  const s = await stat(resolved).catch(() => null);
  if (!s?.isDirectory()) {
    throw new WorkspaceNotFoundError(resolved);
  }

  const gitInfo = await getGitInfo(resolved);

  return {
    path: resolved,
    name: path.basename(resolved),
    git: gitInfo,
  };
}
