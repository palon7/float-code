import type {
  ClaudeCodeSession,
  ParsedEntry,
  SystemEntry,
} from "@palon7/cc-client";
import type { ConnectionRegistry } from "../ws/connection-registry.js";
import type { PidTracker } from "./pid-tracker.js";
import type { ActiveSessionState } from "./active-session-state.js";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "session" });

export class ClaudeSessionEventHandler {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly pidTracker: PidTracker,
    private readonly activeSessionState: ActiveSessionState,
  ) {}

  attach(session: ClaudeCodeSession): void {
    const isStale = () => !this.activeSessionState.isCurrentSession(session);

    session.on("entry", (entry: ParsedEntry) => {
      if (isStale()) return;

      if (entry.kind === "system") {
        this.handleSystemEntry(session, entry as SystemEntry);
        return;
      }

      const live = this.activeSessionState.getCurrent()!;
      const sessionId = live.meta.sessionId ?? "";

      log.debug({ sessionId, kind: entry.kind }, "session.entry");

      if (
        (entry.kind === "text" || entry.kind === "thinking") &&
        entry.isStreaming
      ) {
        const updated = live.entryBuffer.appendTextDelta(entry.id, entry.text);
        if (!updated) {
          live.entryBuffer.add(entry);
          this.registry.broadcast("session.entry", {
            sessionId,
            entry,
          });
        } else {
          this.registry.broadcast("session.entry", {
            sessionId,
            entry: updated,
          });
        }
        return;
      }

      if (entry.kind === "tool_call" && entry.isStreaming) {
        const replaced = live.entryBuffer.replaceEntry(entry.id, entry);
        if (!replaced) {
          live.entryBuffer.add(entry);
        }
        this.registry.broadcast("session.entry", {
          sessionId,
          entry,
        });
        return;
      }

      live.entryBuffer.clearStreaming();

      if (entry.kind === "result") {
        this.activeSessionState.setLastResult(entry);
      }

      live.entryBuffer.add(entry);
      this.registry.broadcast("session.entry", {
        sessionId,
        entry,
      });
    });

    session.on("end", () => {
      if (isStale()) return;
      this.handleEnd(session);
    });

    session.on("error", () => {
      // end イベントが後続するのでクリーンアップはそちらで行う
    });
  }

  private handleSystemEntry(
    session: ClaudeCodeSession,
    systemEntry: SystemEntry,
  ): void {
    const queuedMessages = this.activeSessionState.updateRunning(
      systemEntry.sessionId,
      systemEntry.model,
    );
    const live = this.activeSessionState.getCurrent()!;

    for (const queuedMessage of queuedMessages) {
      session.send(queuedMessage);
    }

    log.info(
      {
        pid: session.pid,
        sessionId: systemEntry.sessionId,
        model: systemEntry.model,
      },
      "Claude CLI started",
    );
    if (queuedMessages.length > 0) {
      log.debug({ count: queuedMessages.length }, "Queued messages flushed");
    }

    this.registry.broadcast("session.started", {
      sessionId: systemEntry.sessionId,
      status: "running",
      meta: {
        workspacePath: live.meta.workspacePath,
        model: live.meta.model,
      },
    });
  }

  private handleEnd(session: ClaudeCodeSession): void {
    const live = this.activeSessionState.getCurrent()!;
    live.entryBuffer.clearStreaming();

    const sessionId = live.meta.sessionId ?? "";
    const exitReason = session.exitReason ?? "complete";

    if (live.status === "spawning") {
      this.activeSessionState.clearQueuedMessages();
      log.warn({ exitReason }, "Claude CLI exited during spawn");
      this.registry.broadcast("session.error", {
        code: "SESSION_SPAWN_FAILED",
        message: `Claude CLI exited during spawning: ${exitReason}`,
      });
      this.activeSessionState.clearCurrent();
    } else {
      log.info({ sessionId, exitReason }, "Claude CLI done");
      this.registry.broadcast("session.done", {
        sessionId,
        exitReason,
        result: live.lastResult,
      });
      this.activeSessionState.transitionToIdle();
    }

    if (session.pid !== undefined) {
      this.pidTracker.remove(session.pid).catch(() => {});
    }
  }
}
