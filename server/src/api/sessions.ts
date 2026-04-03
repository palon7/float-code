import { realpath } from "node:fs/promises";
import { Hono } from "hono";
import { getSessionDir, listSessions, loadSession } from "@palon7/cc-client";
import type { SessionSummary } from "@palon7/cc-client";
import type {
  SessionsListResponse,
  SessionListItem,
  SessionDetailResponse,
  SessionStatus,
} from "@float-code/shared/protocol";
import type { SessionManager } from "../session/session-manager.js";
import { WorkspaceNotFoundError } from "../workspace/errors.js";
import { errorResponse } from "./error-response.js";

function toListItem(
  s: SessionSummary,
  liveStatus?: SessionStatus,
): SessionListItem {
  return {
    sessionId: s.sessionId,
    status: liveStatus ?? "idle",
    model: s.model,
    title: s.title,
    numTurns: s.numTurns,
    durationMs: s.durationMs,
    startedAt: s.startedAt,
    lastModified: s.lastModified,
    lastMessage: s.lastMessage,
  };
}

async function resolveWorkspacePath(raw: string): Promise<string> {
  try {
    return await realpath(raw);
  } catch {
    throw new WorkspaceNotFoundError(raw);
  }
}

export function createSessionsRouter(sessionManager: SessionManager) {
  return new Hono()
    .onError((err, c) => {
      if (err instanceof WorkspaceNotFoundError) {
        return errorResponse(c, 404, "WORKSPACE_NOT_FOUND", err.message);
      }
      throw err;
    })
    .use("*", async (c, next) => {
      const workspacePath = c.req.query("workspacePath");
      if (!workspacePath) {
        return errorResponse(
          c,
          400,
          "INVALID_REQUEST",
          "Query parameter 'workspacePath' is required",
        );
      }
      const resolved = await resolveWorkspacePath(workspacePath);
      c.set("resolvedPath" as never, resolved as never);
      await next();
    })
    .get("/", async (c) => {
      const resolved = c.get("resolvedPath" as never) as string;
      const sessionDir = getSessionDir(resolved);
      const summaries = await listSessions(sessionDir);

      const snapshot = sessionManager.getSnapshot();
      const sessions = summaries.map((s) => {
        const liveStatus =
          snapshot && snapshot.sessionId === s.sessionId
            ? snapshot.status
            : undefined;
        return toListItem(s, liveStatus);
      });

      return c.json<SessionsListResponse>({ sessions });
    })
    .get("/:id", async (c) => {
      const resolved = c.get("resolvedPath" as never) as string;
      const sessionId = c.req.param("id");
      const sessionDir = getSessionDir(resolved);

      let detail;
      try {
        detail = await loadSession(sessionDir, sessionId);
      } catch {
        return errorResponse(
          c,
          404,
          "SESSION_NOT_FOUND",
          `Session not found: ${sessionId}`,
        );
      }

      return c.json<SessionDetailResponse>({
        sessionId: detail.sessionId,
        model: detail.model,
        title: detail.title,
        numTurns: detail.numTurns,
        durationMs: detail.durationMs,
        entryCount: detail.entryCount,
        inputTokens: detail.inputTokens,
        outputTokens: detail.outputTokens,
        entries: detail.entries,
      });
    });
}
