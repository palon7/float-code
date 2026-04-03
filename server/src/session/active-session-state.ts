import type { ClaudeCodeSession } from "@palon7/cc-client";
import type { SessionSnapshot } from "@float-code/shared/protocol";
import { EntryBuffer } from "./entry-buffer.js";

export type ActiveSessionStatus = "idle" | "spawning" | "running";

export type ActiveSessionMeta = {
  sessionId?: string;
  workspacePath?: string;
  model?: string;
};

export interface LiveSession {
  session: ClaudeCodeSession | null;
  status: ActiveSessionStatus;
  workspacePath: string;
  entryBuffer: EntryBuffer;
  meta: ActiveSessionMeta;
  lastResult?: unknown;
  sendQueue: string[];
}

export class ActiveSessionState {
  private current: LiveSession | null = null;

  openIdleSession(
    workspacePath: string,
    options?: {
      entryBuffer?: EntryBuffer;
      meta?: ActiveSessionMeta;
    },
  ): LiveSession {
    const live: LiveSession = {
      session: null,
      status: "idle",
      workspacePath,
      entryBuffer: options?.entryBuffer ?? new EntryBuffer(),
      meta: {
        workspacePath,
        ...options?.meta,
      },
      sendQueue: [],
    };
    this.current = live;
    return live;
  }

  activate(
    session: ClaudeCodeSession,
    workspacePath: string,
    existingBuffer?: EntryBuffer,
  ): LiveSession {
    const live: LiveSession = {
      session,
      status: "spawning",
      workspacePath,
      entryBuffer: existingBuffer ?? new EntryBuffer(),
      meta: { workspacePath },
      sendQueue: [],
    };
    this.current = live;
    return live;
  }

  getCurrent(): LiveSession | null {
    return this.current;
  }

  clearCurrent(): void {
    this.current = null;
  }

  isCurrentSession(session: ClaudeCodeSession): boolean {
    return this.current?.session === session;
  }

  getAbortableSession(): ClaudeCodeSession | null {
    const live = this.current;
    if (!live) return null;
    if (live.status !== "running" && live.status !== "spawning") return null;
    return live.session;
  }

  getSnapshot(): SessionSnapshot | undefined {
    const live = this.current;
    if (!live) return undefined;

    return {
      sessionId: live.meta.sessionId,
      status: live.status,
      meta: live.meta,
      entries: live.entryBuffer.getAll(),
    };
  }

  getActiveSessionCount(): number {
    if (!this.current) return 0;
    return this.current.status === "running" ||
      this.current.status === "spawning"
      ? 1
      : 0;
  }

  updateRunning(sessionId: string, model: string): string[] {
    const live = this.requireCurrent();
    live.meta = {
      sessionId,
      workspacePath: live.workspacePath,
      model,
    };
    live.status = "running";

    const queuedMessages = [...live.sendQueue];
    live.sendQueue = [];
    return queuedMessages;
  }

  enqueueMessage(text: string, maxQueueSize: number): boolean {
    const live = this.requireCurrent();
    if (live.sendQueue.length >= maxQueueSize) {
      return false;
    }
    live.sendQueue.push(text);
    return true;
  }

  clearQueuedMessages(): void {
    const live = this.requireCurrent();
    live.sendQueue = [];
  }

  setLastResult(result: unknown): void {
    const live = this.requireCurrent();
    live.lastResult = result;
  }

  transitionToIdle(): LiveSession {
    const live = this.requireCurrent();
    live.status = "idle";
    live.session = null;
    return live;
  }

  private requireCurrent(): LiveSession {
    if (!this.current) {
      throw new Error("Active session is not set");
    }
    return this.current;
  }
}
