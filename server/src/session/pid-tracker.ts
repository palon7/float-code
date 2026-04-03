import { dataPath, readJsonSafe, writeJsonAtomic } from "../utils/fs.js";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "pid-tracker" });

type PidsData = { pids: number[] };

const PIDS_PATH = dataPath("claude-pids.json");
const DEFAULT_DATA: PidsData = { pids: [] };

export class PidTracker {
  private pids = new Set<number>();

  async add(pid: number): Promise<void> {
    log.debug({ pid }, "PID registered");
    this.pids.add(pid);
    await this.persist();
  }

  async remove(pid: number): Promise<void> {
    log.debug({ pid }, "PID unregistered");
    this.pids.delete(pid);
    await this.persist();
  }

  // 起動時にファイルから残存 PID を読み込んで SIGTERM を送る
  async killOrphans(): Promise<void> {
    const data = await readJsonSafe<PidsData>(PIDS_PATH, DEFAULT_DATA);
    const orphans = data.pids.filter((pid) => Number.isInteger(pid) && pid > 1);
    if (orphans.length > 0) {
      log.info({ pids: orphans }, "Killing orphan PIDs");
    }
    for (const pid of orphans) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // プロセスが既にいない場合は無視
      }
    }
    // ファイルをリセット
    await writeJsonAtomic(PIDS_PATH, DEFAULT_DATA).catch(() => {});
  }

  // process.on('exit') から同期的に呼ぶ安全ネット
  killAllSync(): void {
    for (const pid of this.pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // 無視
      }
    }
  }

  private pendingPersist: Promise<void> = Promise.resolve();

  private async persist(): Promise<void> {
    this.pendingPersist = this.pendingPersist.then(() =>
      writeJsonAtomic(PIDS_PATH, { pids: [...this.pids] }),
    );
    await this.pendingPersist;
  }
}
