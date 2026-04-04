import type {
  ServerMessage,
  SessionSnapshot,
  SessionStatus,
} from "@float-code/shared/protocol";
import { isParsedEntry } from "@float-code/shared/protocol/entry-guard";
import type { ToolResultEntry } from "@palon7/cc-client";
import type { LogLine } from "./session-format";

export interface SessionState {
  lines: readonly LogLine[];
  sessionStatus: SessionStatus | "none";
  hasActive: boolean;
  sessionId: string | null;
  workspacePath: string | null;
}

export const INITIAL_SESSION_STATE: SessionState = {
  lines: [],
  sessionStatus: "none",
  hasActive: false,
  sessionId: null,
  workspacePath: null,
};

const MAX_LINES = 200;

function trimLines(lines: LogLine[]): LogLine[] {
  return lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines;
}

// tool_result を対応する tool_call 行に紐づける
function attachToolResult(
  lines: readonly LogLine[],
  result: ToolResultEntry,
): LogLine[] | null {
  const idx = lines.findLastIndex(
    (l) =>
      l.entry.kind === "tool_call" && l.entry.toolUseId === result.toolUseId,
  );
  return idx === -1
    ? null
    : lines.map((l, i) => (i === idx ? { ...l, result } : l));
}

// streaming entry の同一 id 上書き
function replaceExistingLine(
  lines: readonly LogLine[],
  entry: LogLine["entry"],
): LogLine[] | null {
  const idx = lines.findLastIndex((l) => l.id === entry.id);
  return idx === -1
    ? null
    : lines.map((l, i) => (i === idx ? { id: entry.id, entry } : l));
}

// finalized entry が来たら対応する streaming 版を除去
function removeSupersededStreaming(
  lines: readonly LogLine[],
  incoming: LogLine["entry"],
): readonly LogLine[] {
  if ("isStreaming" in incoming && incoming.isStreaming) return lines;

  return lines.filter((l) => {
    const e = l.entry;
    if (!("isStreaming" in e) || !e.isStreaming) return true;
    if (e.kind !== incoming.kind) return true;
    if (
      e.kind === "tool_call" &&
      incoming.kind === "tool_call" &&
      e.toolUseId !== incoming.toolUseId
    )
      return true;
    return false;
  });
}

// Claude Code internal notifications that should not be shown to the user
const HIDDEN_NOTIFICATION_SUBTYPES = new Set([
  "task_started",
  "task_progress",
  "task_completed",
  "task_notification",
]);

function isHiddenNotification(entry: LogLine["entry"]): boolean {
  return (
    entry.kind === "notification" &&
    HIDDEN_NOTIFICATION_SUBTYPES.has(entry.subtype)
  );
}

function processEntry(
  lines: readonly LogLine[],
  raw: unknown,
): Partial<SessionState> | null {
  if (!isParsedEntry(raw)) return null;
  if (isHiddenNotification(raw)) return null;

  if (raw.kind === "tool_result") {
    const next = attachToolResult(lines, raw);
    return next ? { lines: next } : null;
  }

  const replaced = replaceExistingLine(lines, raw);
  if (replaced) return { lines: replaced };

  const cleaned = removeSupersededStreaming(lines, raw);
  const next = trimLines([...cleaned, { id: raw.id, entry: raw }]);

  return {
    lines: next,
    ...(raw.kind === "result" ? { sessionStatus: "idle" as const } : {}),
  };
}

function restoreSnapshot(snapshot: SessionSnapshot): SessionState {
  const parsed = snapshot.entries.filter(isParsedEntry);
  const resultMap = new Map<string, ToolResultEntry>();
  for (const entry of parsed) {
    if (entry.kind === "tool_result") {
      resultMap.set(entry.toolUseId, entry);
    }
  }

  return {
    lines: trimLines(
      parsed
        .filter((e) => e.kind !== "tool_result" && !isHiddenNotification(e))
        .map((entry) => ({
          id: entry.id,
          entry,
          result:
            entry.kind === "tool_call"
              ? resultMap.get(entry.toolUseId)
              : undefined,
        })),
    ),
    sessionStatus: snapshot.status,
    hasActive: true,
    sessionId: snapshot.sessionId ?? snapshot.meta?.sessionId ?? null,
    workspacePath: snapshot.meta?.workspacePath ?? null,
  };
}

export function reduceMessage(
  state: SessionState,
  msg: ServerMessage,
): Partial<SessionState> | null {
  switch (msg.type) {
    case "auth.ok":
      return msg.activeSession
        ? restoreSnapshot(msg.activeSession)
        : INITIAL_SESSION_STATE;

    case "session.opened":
      return restoreSnapshot(msg);

    case "session.started":
      return {
        hasActive: true,
        sessionStatus: msg.status,
        sessionId: msg.sessionId,
        workspacePath: msg.meta?.workspacePath ?? state.workspacePath,
      };

    case "session.entry":
      return processEntry(state.lines, msg.entry);

    case "session.permission.request":
      return { sessionStatus: "waiting_permission" };

    case "session.permission.resolved":
      return { sessionStatus: "running" };

    case "session.done":
      return { sessionStatus: "idle" };

    case "session.error":
      return {
        sessionStatus: "idle",
        ...(msg.code === "SESSION_NOT_FOUND" ||
        msg.code === "SESSION_SPAWN_FAILED"
          ? { hasActive: false }
          : {}),
      };

    case "auth.error":
    case "auth.challenge":
    case "pong":
      return null;
  }
}

export function reduceLocalUserMessage(
  state: SessionState,
  text: string,
): Partial<SessionState> {
  const now = Date.now();
  const id = `user-${now}`;
  return {
    lines: trimLines([
      ...state.lines,
      {
        id,
        entry: {
          kind: "user_message",
          id,
          timestamp: new Date(now).toISOString(),
          text,
        },
      },
    ]),
    sessionStatus: "running",
  };
}
