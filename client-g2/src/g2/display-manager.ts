import {
  TextContainerProperty,
  TextContainerUpgrade,
  ListContainerProperty,
  RebuildPageContainer,
} from "@evenrealities/even_hub_sdk";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";

export interface G2PageDef {
  textContainers?: TextContainerProperty[];
  listContainers?: ListContainerProperty[];
}

export class G2DisplayManager {
  private bridge: EvenAppBridge | null = null;
  private containerIdMap = new Map<string, number>();
  private pageChain = Promise.resolve();
  private pageSeq = 0;
  private displayEpoch = 0;
  private updateState = new Map<string, { desired: string | null }>();
  private lastRebuildAt = 0;
  private inflightUpgrades = new Set<Promise<unknown>>();
  onDrainIdle: (() => void) | null = null;
  onDebugLog: ((message: string) => void) | null = null;

  setBridge(bridge: EvenAppBridge): void {
    this.bridge = bridge;
  }

  /** 画面を丸ごと差し替えて rebuild */
  async setPage(page: G2PageDef): Promise<void> {
    const seq = ++this.pageSeq;
    this.displayEpoch++;
    this.updateState.clear();
    const containerNames = [
      ...(page.textContainers ?? []),
      ...(page.listContainers ?? []),
    ].map((c) => c.containerName ?? "?");
    this.onDebugLog?.(`setPage #${seq} queued [${containerNames.join(",")}]`);
    const nextPage = this.pageChain.then(() => this.applyPage(page, seq));
    this.pageChain = nextPage.catch(() => {});
    return nextPage;
  }

  private async applyPage(page: G2PageDef, seq: number): Promise<void> {
    this.onDebugLog?.(`applyPage #${seq} start`);
    const allContainers = [
      ...(page.textContainers ?? []),
      ...(page.listContainers ?? []),
    ];
    if (allContainers.length === 0) return;

    // ID 割り当て
    const nextMap = new Map<string, number>();
    for (let i = 0; i < allContainers.length; i++) {
      allContainers[i].containerID = i + 1;
      allContainers[i].isEventCapture = 0;
      if (allContainers[i].containerName) {
        nextMap.set(allContainers[i].containerName!, i + 1);
      }
    }
    allContainers[allContainers.length - 1].isEventCapture = 1;

    await this.waitInflightUpgrades();
    await this.rebuild(page, seq);
    this.containerIdMap = nextMap;
    this.onDebugLog?.(`applyPage #${seq} done`);
  }

  getContainerId(containerName: string): number | null {
    return this.containerIdMap.get(containerName) ?? null;
  }

  hasPendingUpdate(containerName: string): boolean {
    const entry = this.updateState.get(containerName);
    return entry != null && entry.desired != null;
  }

  updateText(containerName: string, text: string): void {
    const existing = this.updateState.get(containerName);
    if (existing) {
      existing.desired = text;
      return;
    }
    const entry = { desired: text };
    this.updateState.set(containerName, entry);
    void this.drainUpdates(containerName);
  }

  private async drainUpdates(containerName: string): Promise<void> {
    const epoch = this.displayEpoch;
    let didSend = false;

    while (this.displayEpoch === epoch) {
      const entry = this.updateState.get(containerName);
      if (!entry || entry.desired == null) break;

      const id = this.containerIdMap.get(containerName);
      if (id == null || !this.bridge) break;

      const text = entry.desired;
      entry.desired = null;
      didSend = true;

      const p = this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: id,
          containerName: containerName,
          contentOffset: 0,
          contentLength: text.length,
          content: text,
        }),
      );
      this.inflightUpgrades.add(p);
      try {
        await p;
      } finally {
        this.inflightUpgrades.delete(p);
      }
    }

    // epoch が変わった場合は setPage 側で updateState.clear() 済みなので削除しない
    if (this.displayEpoch === epoch) {
      this.updateState.delete(containerName);
      if (didSend) {
        this.onDrainIdle?.();
      }
    }
  }

  // rebuild 前に in-flight の textContainerUpgrade を待つ（タイムアウト付き）
  private static readonly UPGRADE_DRAIN_TIMEOUT_MS = 500;

  private async waitInflightUpgrades(): Promise<void> {
    if (this.inflightUpgrades.size === 0) return;
    this.onDebugLog?.(
      `waiting for ${this.inflightUpgrades.size} inflight upgrade(s)`,
    );
    await Promise.race([
      Promise.allSettled(this.inflightUpgrades),
      new Promise<void>((r) =>
        setTimeout(r, G2DisplayManager.UPGRADE_DRAIN_TIMEOUT_MS),
      ),
    ]);
  }

  // Flutter 側が応答しない場合にチェーンが詰まるのを防ぐタイムアウト
  private static readonly REBUILD_TIMEOUT_MS = 3000;
  // 連続 rebuild でファームウェアが取りこぼすのを防ぐ最低インターバル
  private static readonly MIN_REBUILD_INTERVAL_MS = 120;

  private async rebuild(page: G2PageDef, seq: number): Promise<void> {
    const bridge = this.bridge;
    if (!bridge) {
      this.onDebugLog?.(`rebuild #${seq} skip (no bridge)`);
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastRebuildAt;
    if (elapsed < G2DisplayManager.MIN_REBUILD_INTERVAL_MS) {
      const wait = G2DisplayManager.MIN_REBUILD_INTERVAL_MS - elapsed;
      this.onDebugLog?.(`rebuild #${seq} waiting ${wait}ms (interval guard)`);
      await new Promise<void>((r) => setTimeout(r, wait));
    }

    const textObject = page.textContainers ?? [];
    const listObject = page.listContainers ?? [];
    const total = textObject.length + listObject.length;
    this.onDebugLog?.(`rebuild #${seq} calling (${total} containers)`);

    const request = new RebuildPageContainer({
      containerTotalNum: total,
      textObject: textObject.length > 0 ? textObject : undefined,
      listObject: listObject.length > 0 ? listObject : undefined,
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.lastRebuildAt = Date.now();
        this.onDebugLog?.(`rebuild #${seq} timeout`);
        reject(new Error(`rebuild #${seq} timeout`));
      }, G2DisplayManager.REBUILD_TIMEOUT_MS);

      void bridge.rebuildPageContainer(request).then(
        (result) => {
          this.lastRebuildAt = Date.now();
          if (settled) {
            this.onDebugLog?.(
              `rebuild #${seq} resolved after timeout: ${result}`,
            );
            return;
          }
          settled = true;
          clearTimeout(timer);
          this.onDebugLog?.(`rebuild #${seq} resolved: ${result}`);
          resolve();
        },
        (error) => {
          this.lastRebuildAt = Date.now();
          clearTimeout(timer);
          if (settled) {
            this.onDebugLog?.(
              `rebuild #${seq} rejected after timeout: ${String(error)}`,
            );
            return;
          }
          settled = true;
          this.onDebugLog?.(`rebuild #${seq} rejected: ${String(error)}`);
          reject(error);
        },
      );
    });
  }
}
