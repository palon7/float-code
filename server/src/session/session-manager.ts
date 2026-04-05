import { realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  ClaudeCodeClient,
  getSessionDir,
  loadSession as loadSessionFromDisk,
} from "@palon7/cc-client";
import type { ParsedEntry } from "@palon7/cc-client";
import type { SessionSnapshot } from "@float-code/shared/protocol";
import type { ConnectionRegistry } from "../ws/connection-registry.js";
import { EntryBuffer } from "./entry-buffer.js";
import { PidTracker } from "./pid-tracker.js";
import { getConfig } from "../config.js";
import { touchRecent } from "../workspace/workspace-store.js";
import {
  ActiveSessionState,
  type LiveSession,
} from "./active-session-state.js";
import { ClaudeSessionEventHandler } from "./claude-session-event-handler.js";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "session" });

const ABORT_TIMEOUT_MS = 5_000;
const MAX_SEND_QUEUE = 10;

function raceWithTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

export class SessionManager {
  private readonly activeSessionState = new ActiveSessionState();
  private readonly eventHandler: ClaudeSessionEventHandler;

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly pidTracker: PidTracker,
  ) {
    this.eventHandler = new ClaudeSessionEventHandler(
      registry,
      pidTracker,
      this.activeSessionState,
    );
  }

  async openNewSession(workspacePath: string): Promise<void> {
    const resolved = await this.resolveWorkspace(workspacePath);
    if (!resolved) return;

    await this.abortActiveIfRunning();

    this.activeSessionState.openIdleSession(resolved);

    log.info({ workspacePath: resolved }, "Session opened (new)");
    touchRecent(resolved).catch(() => {});
    this.registry.broadcast("session.opened", this.getSnapshot()!);
  }

  async loadSession(sessionId: string, workspacePath: string): Promise<void> {
    const resolved = await this.resolveWorkspace(workspacePath);
    if (!resolved) return;

    await this.abortActiveIfRunning();

    let detail;
    try {
      detail = await loadSessionFromDisk(getSessionDir(resolved), sessionId);
    } catch {
      log.warn(
        { workspacePath: resolved, sessionId },
        "Session not found on disk",
      );
      this.registry.broadcast("session.error", {
        code: "SESSION_NOT_FOUND",
        message: `Session not found: ${sessionId}`,
      });
      return;
    }

    const entryBuffer = new EntryBuffer();
    for (const entry of detail.entries) {
      entryBuffer.add(entry);
    }

    this.activeSessionState.openIdleSession(resolved, {
      entryBuffer,
      meta: { sessionId, workspacePath: resolved, model: detail.model },
    });

    log.info(
      { workspacePath: resolved, sessionId, entryCount: detail.entries.length },
      "Session loaded (resume)",
    );
    touchRecent(resolved).catch(() => {});
    this.registry.broadcast("session.opened", this.getSnapshot()!);
  }

  send(text: string): void {
    const live = this.requireActive();
    if (!live) return;

    this.broadcastUserMessage(live, text);

    if (live.status === "idle") {
      if (live.meta.sessionId) {
        log.info(
          { workspacePath: live.workspacePath, sessionId: live.meta.sessionId },
          "session.send: resume CLI",
        );
        this.startResume(live, live.meta.sessionId, text);
      } else {
        log.info(
          { workspacePath: live.workspacePath },
          "session.send: start new CLI",
        );
        this.startNew(live, text);
      }
      return;
    }

    if (live.status === "running" && live.session) {
      try {
        live.session.send(text);
        log.info(
          { sessionId: live.meta.sessionId },
          "session.send: forwarded to stdin",
        );
        return;
      } catch {
        // stdinが閉じている（result受信後〜プロセス終了前）場合、auto-resumeへ
        if (live.meta.sessionId) {
          log.info(
            { sessionId: live.meta.sessionId },
            "session.send: auto-resume (stdin closed)",
          );
          this.startResume(live, live.meta.sessionId, text);
          return;
        }
        this.registry.broadcast("session.error", {
          code: "SESSION_SEND_FAILED",
          message: "Cannot send: stdin closed and no session ID for resume",
        });
      }
      return;
    }

    if (live.status === "spawning") {
      if (!this.activeSessionState.enqueueMessage(text, MAX_SEND_QUEUE)) {
        log.warn(
          { limit: MAX_SEND_QUEUE },
          "session.send: queue full, dropping message",
        );
        this.registry.broadcast("session.error", {
          code: "SESSION_SEND_QUEUE_FULL",
          message: `Session send queue exceeded limit (${MAX_SEND_QUEUE})`,
        });
        return;
      }
      log.debug(
        { queueLength: live.sendQueue.length },
        "session.send: queued (spawning)",
      );
      return;
    }
  }

  private broadcastUserMessage(live: LiveSession, text: string): void {
    const sessionId = live.meta.sessionId ?? "";
    const entry: ParsedEntry = {
      kind: "user_message",
      id: `user-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      text,
    };
    live.entryBuffer.add(entry);
    this.registry.broadcast("session.entry", { sessionId, entry });
  }

  interrupt(): void {
    const live = this.requireActive();
    if (!live) return;

    if (live.status === "running" && live.session) {
      live.session.interrupt();
      return;
    }

    log.warn({ status: live.status }, "session.interrupt: not running");
    this.registry.broadcast("session.error", {
      code: "SESSION_NOT_RUNNING",
      message: "Session is not running",
    });
  }

  abort(): void {
    const live = this.requireActive();
    if (!live) return;

    if (
      (live.status === "running" || live.status === "spawning") &&
      live.session
    ) {
      live.session.abort();
      return;
    }

    log.warn({ status: live.status }, "session.abort: not running");
    this.registry.broadcast("session.error", {
      code: "SESSION_NOT_RUNNING",
      message: "Session is not running",
    });
  }

  getSnapshot(): SessionSnapshot | undefined {
    return this.activeSessionState.getSnapshot();
  }

  getActiveSessionCount(): number {
    return this.activeSessionState.getActiveSessionCount();
  }

  async killOrphans(): Promise<void> {
    await this.pidTracker.killOrphans();
  }

  async shutdown(): Promise<void> {
    const session = this.activeSessionState.getAbortableSession();
    if (session) {
      session.abort();
      await raceWithTimeout(session.done(), ABORT_TIMEOUT_MS);
    }

    this.pidTracker.killAllSync();
  }

  killAllSync(): void {
    this.pidTracker.killAllSync();
  }

  private startNew(live: LiveSession, text: string): void {
    const client = this.createClient(live.workspacePath);
    this.activateSession(client.start(text), live.workspacePath);
  }

  private startResume(
    live: LiveSession,
    sessionId: string,
    text: string,
  ): void {
    const client = this.createClient(live.workspacePath);
    this.activateSession(
      client.resume(sessionId, text),
      live.workspacePath,
      live.entryBuffer,
    );
  }

  private createClient(workspacePath: string): ClaudeCodeClient {
    return new ClaudeCodeClient({
      workspacePath,
      ...getConfig().claude,
    });
  }

  private async resolveWorkspace(
    workspacePath: string,
  ): Promise<string | null> {
    try {
      return await realpath(workspacePath);
    } catch {
      log.warn({ workspacePath }, "Workspace not found");
      this.registry.broadcast("session.error", {
        code: "WORKSPACE_NOT_FOUND",
        message: `Workspace not found: ${workspacePath}`,
      });
      return null;
    }
  }

  private activateSession(
    session: import("@palon7/cc-client").ClaudeCodeSession,
    resolved: string,
    existingBuffer?: EntryBuffer,
  ): void {
    this.activeSessionState.activate(session, resolved, existingBuffer);

    log.info(
      { pid: session.pid, workspacePath: resolved },
      "Claude CLI spawning",
    );

    if (session.pid !== undefined) {
      this.pidTracker.add(session.pid).catch(() => {});
    }

    this.eventHandler.attach(session);
  }

  private requireActive(): LiveSession | null {
    const live = this.activeSessionState.getCurrent();
    if (!live) {
      this.registry.broadcast("session.error", {
        code: "SESSION_NOT_FOUND",
        message: "No active session",
      });
      return null;
    }
    return live;
  }

  private async abortActiveIfRunning(): Promise<void> {
    const session = this.activeSessionState.getAbortableSession();
    if (!session) return;

    session.abort();
    await raceWithTimeout(session.done(), ABORT_TIMEOUT_MS);
  }
}
