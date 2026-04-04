import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useStdout } from "ink";
import TextInput from "ink-text-input";
import { Spinner } from "@inkjs/ui";
import { WsClient, MAX_RETRIES } from "../client/ws.js";
import type { ConnectionStatus } from "../client/ws.js";
import type {
  ServerMessage,
  SessionSnapshot,
} from "@float-code/shared/protocol";
import type { ParsedEntry, ToolResultEntry } from "@palon7/cc-client";
import { isParsedEntry } from "@float-code/shared/protocol/entry-guard";
import { truncate } from "../utils.js";

const MAX_LOGS = 100;

interface LogEntry {
  id: string;
  msg: ServerMessage;
  result?: ToolResultEntry;
}

const PRIMARY_PARAM_KEYS: Record<string, string[]> = {
  read: ["file_path"],
  write: ["file_path"],
  edit: ["file_path"],
  bash: ["command"],
  glob: ["pattern"],
  grep: ["pattern"],
  webfetch: ["url"],
  task: ["description", "prompt"],
};

function formatToolName(toolName: string): string {
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    return `${parts[1]}:${parts.slice(2).join(":")}`;
  }
  return toolName;
}

function getPrimaryParam(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const keys = PRIMARY_PARAM_KEYS[toolName.toLowerCase()];
  const raw = keys
    ? keys.reduce<unknown>((v, k) => v ?? input[k], undefined)
    : Object.values(input)[0];
  if (raw == null) return "";
  return truncate(String(raw), 80);
}

function EntryView({
  entry,
  result,
}: {
  entry: ParsedEntry;
  result?: ToolResultEntry;
}) {
  switch (entry.kind) {
    case "text":
      return <Text>{entry.text}</Text>;

    case "thinking":
      return (
        <Text dimColor italic>
          {"💭 "}
          {truncate(entry.text, 120)}
        </Text>
      );

    case "tool_call": {
      const primary = getPrimaryParam(entry.toolName, entry.input);
      const displayName = formatToolName(entry.toolName);
      return (
        <Text>
          <Text color="yellow">{"⏺ "}</Text>
          <Text color="yellow" bold>
            {displayName}
          </Text>
          {primary ? <Text dimColor>{" " + primary}</Text> : null}
          {result && (
            <Text>
              {"\n"}
              <Text
                color={result.isError ? "red" : undefined}
                dimColor={!result.isError}
              >
                {"  ⎿ "}
                {truncate(result.content, 120)}
              </Text>
            </Text>
          )}
        </Text>
      );
    }

    case "result":
      return (
        <Text>
          <Text color={entry.isError ? "red" : "green"}>
            {entry.isError ? "✗ Error" : "✓ Done"}
          </Text>
          <Text dimColor>
            {` (${entry.numTurns} turns, $${entry.totalCostUsd.toFixed(4)}, ${(entry.durationMs / 1000).toFixed(1)}s)`}
          </Text>
        </Text>
      );

    case "system":
      return (
        <Text>
          <Text color="cyan">{"⏺ Session started"}</Text>
          <Text dimColor>{` model=${entry.model}`}</Text>
        </Text>
      );

    case "user_message":
      return (
        <Text color="blue">
          {"❯ "}
          {truncate(entry.text, 120)}
        </Text>
      );

    case "notification":
      return <Text dimColor>{entry.text}</Text>;

    default:
      return null;
  }
}

function MessageView({
  msg,
  result,
}: {
  msg: ServerMessage;
  result?: ToolResultEntry;
}) {
  switch (msg.type) {
    case "session.entry":
      if (isParsedEntry(msg.entry)) {
        return <EntryView entry={msg.entry} result={result} />;
      }
      return <Text dimColor>{`[entry] ${JSON.stringify(msg.entry)}`}</Text>;

    case "session.started":
      return (
        <Text>
          <Text color="cyan">{"⏺ Session started"}</Text>
          <Text dimColor>{` status=${msg.status}`}</Text>
        </Text>
      );

    case "session.error":
      return (
        <Text color="red">
          {"✗ "}
          {msg.code}: {msg.message}
        </Text>
      );

    case "session.permission.request":
      return (
        <Text color="yellow">
          {"⚠ Permission: "}
          <Text bold>{msg.toolName}</Text>
        </Text>
      );

    case "session.permission.resolved":
      return (
        <Text dimColor>
          {"⚠ Permission resolved: "}
          {msg.decision}
        </Text>
      );

    case "auth.error":
      return (
        <Text color="red">
          {"✗ Auth error: "}
          {msg.message}
        </Text>
      );

    case "auth.challenge":
    case "pairing.pending":
      return null;

    default:
      return null;
  }
}

const SILENT_TYPES = new Set<ServerMessage["type"]>([
  "pong",
  "session.opened",
  "session.done",
]);

function restoreEntries(snapshot: SessionSnapshot): LogEntry[] {
  const parsed = snapshot.entries.filter(isParsedEntry);
  const resultMap = new Map<string, ToolResultEntry>();
  for (const entry of parsed) {
    if (entry.kind === "tool_result") {
      resultMap.set(entry.toolUseId, entry);
    }
  }
  return parsed
    .filter((entry) => entry.kind !== "tool_result")
    .map((entry) => ({
      id: entry.id,
      msg: {
        type: "session.entry" as const,
        sessionId: snapshot.sessionId ?? "",
        entry,
        timestamp: "",
      },
      result:
        entry.kind === "tool_call" ? resultMap.get(entry.toolUseId) : undefined,
    }));
}

function getLogId(msg: ServerMessage): string {
  if (msg.type === "session.entry" && isParsedEntry(msg.entry)) {
    return msg.entry.id;
  }
  return crypto.randomUUID();
}

function statusText(status: ConnectionStatus): string {
  switch (status.state) {
    case "disconnected":
      return "disconnected";
    case "connecting":
      return "connecting...";
    case "authenticating":
      return "authenticating...";
    case "connected":
      return "connected";
    case "pairing":
      return `pairing: ${status.code}`;
    case "reconnecting":
      return `reconnecting (${status.attempt}/${MAX_RETRIES})...`;
    case "error":
      return `error: ${status.reason}`;
  }
}

function statusColor(status: ConnectionStatus): string {
  switch (status.state) {
    case "connected":
      return "green";
    case "pairing":
      return "yellow";
    case "error":
      return "red";
    case "connecting":
    case "authenticating":
    case "reconnecting":
      return "yellow";
    default:
      return "gray";
  }
}

type ChatViewProps = {
  wsClient: WsClient;
  workspacePath: string;
  onCommand: (command: string) => boolean;
  clearScreen: () => void;
};

export function ChatView({
  wsClient,
  workspacePath,
  onCommand,
  clearScreen,
}: ChatViewProps) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const [input, setInput] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>({
    state: "disconnected",
  });
  const [sessionRunning, setSessionRunningRaw] = useState(false);
  const sessionStateRef = useRef({ hasActive: false, running: false });
  const wsClientRef = useRef(wsClient);
  wsClientRef.current = wsClient;

  const setSessionRunning = useCallback((v: boolean) => {
    sessionStateRef.current.running = v;
    setSessionRunningRaw(v);
  }, []);

  const setHasActiveSession = useCallback((v: boolean) => {
    sessionStateRef.current.hasActive = v;
  }, []);

  const addMessage = useCallback(
    (msg: ServerMessage) => {
      if (
        msg.type === "session.done" ||
        msg.type === "session.error" ||
        (msg.type === "session.entry" &&
          isParsedEntry(msg.entry) &&
          msg.entry.kind === "result")
      ) {
        setSessionRunning(false);
      }

      if (msg.type === "auth.ok") {
        setHasActiveSession(Boolean(msg.activeSession));
        if (msg.activeSession) {
          const snapshot = msg.activeSession;
          setLogs(restoreEntries(snapshot).slice(-MAX_LOGS));
          setSessionRunning(
            snapshot.status === "running" || snapshot.status === "spawning",
          );
        } else {
          clearScreen();
          setLogs([]);
          setSessionRunning(false);
          // アクティブセッションがなければ自動でセッションを開く
          wsClientRef.current.openSession({ workspacePath });
        }
        return;
      }

      if (msg.type === "session.opened") {
        clearScreen();
        setHasActiveSession(true);
        setSessionRunning(false);
        setLogs(restoreEntries(msg).slice(-MAX_LOGS));
      } else if (msg.type === "session.started") {
        setHasActiveSession(true);
        setSessionRunning(true);
      } else if (msg.type === "session.done") {
        setHasActiveSession(true);
        setSessionRunning(false);
      } else if (
        msg.type === "session.error" &&
        (msg.code === "SESSION_NOT_FOUND" ||
          msg.code === "SESSION_SPAWN_FAILED")
      ) {
        setHasActiveSession(false);
      }

      if (SILENT_TYPES.has(msg.type)) return;

      if (
        msg.type === "session.entry" &&
        isParsedEntry(msg.entry) &&
        msg.entry.kind === "tool_result"
      ) {
        const resultEntry = msg.entry;
        setLogs((prev) => {
          const idx = prev.findLastIndex(
            (e) =>
              e.msg.type === "session.entry" &&
              isParsedEntry(e.msg.entry) &&
              e.msg.entry.kind === "tool_call" &&
              e.msg.entry.toolUseId === resultEntry.toolUseId,
          );
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = { ...next[idx], result: resultEntry };
            return next;
          }
          return prev;
        });
        return;
      }

      const id = getLogId(msg);
      setLogs((prev) => {
        const idx = prev.findLastIndex((e) => e.id === id);
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = { id, msg };
          return next;
        }

        let base = prev;
        if (msg.type === "session.entry" && isParsedEntry(msg.entry)) {
          const entry = msg.entry;
          if (!("isStreaming" in entry && entry.isStreaming)) {
            base = prev.filter((e) => {
              if (e.msg.type !== "session.entry" || !isParsedEntry(e.msg.entry))
                return true;
              const pe = e.msg.entry;
              if (!("isStreaming" in pe) || !pe.isStreaming) return true;
              if (pe.kind !== entry.kind) return true;
              if (
                pe.kind === "tool_call" &&
                entry.kind === "tool_call" &&
                pe.toolUseId !== entry.toolUseId
              )
                return true;
              return false;
            });
          }
        }

        const next = [...base, { id, msg }];
        if (next.length > MAX_LOGS) return next.slice(-MAX_LOGS);
        return next;
      });
    },
    [setHasActiveSession, setSessionRunning, clearScreen, workspacePath],
  );

  useEffect(() => {
    const unsubStatus = wsClient.onStatusChange(setStatus);
    const unsubMessage = wsClient.onMessage(addMessage);
    setStatus(wsClient.getStatus());

    return () => {
      unsubStatus();
      unsubMessage();
    };
  }, [wsClient, addMessage]);

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;

      if (trimmed.startsWith("/")) {
        if (onCommand(trimmed)) {
          setInput("");
          return;
        }
      }

      const client = wsClientRef.current;
      if (client.getStatus().state !== "connected") return;

      const userLogEntry: LogEntry = {
        id: `user-${crypto.randomUUID()}`,
        msg: {
          type: "session.entry" as const,
          sessionId: "",
          entry: {
            kind: "user_message" as const,
            id: `user-${crypto.randomUUID()}`,
            timestamp: new Date().toISOString(),
            text: value,
          },
          timestamp: "",
        },
      };
      setLogs((prev) => [...prev, userLogEntry].slice(-MAX_LOGS));

      const { hasActive, running } = sessionStateRef.current;
      if (hasActive || running) {
        client.sendText(value);
        setSessionRunning(true);
      }
      // hasActive=false && running=false の場合:
      // session.openがまだ送信されていない（session選択画面からの遷移で送信済みのはず）
      // session.openedを待ってから送信する必要があるため、ここでは何もしない
      setInput("");
    },
    [workspacePath, onCommand, setSessionRunning],
  );

  const homedir = process.env.HOME ?? "";
  const displayPath = homedir
    ? workspacePath.replace(homedir, "~")
    : workspacePath;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        {logs.length > 0 ? (
          logs.map((log) => {
            const isUserMessage =
              log.msg.type === "session.entry" &&
              isParsedEntry(log.msg.entry) &&
              log.msg.entry.kind === "user_message";

            if (isUserMessage) {
              return (
                <Box key={log.id} marginTop={1} marginBottom={1} paddingX={1}>
                  <Text backgroundColor="#1a1a2e">
                    <MessageView msg={log.msg} result={log.result} />
                  </Text>
                </Box>
              );
            }

            return (
              <Text key={log.id}>
                <MessageView msg={log.msg} result={log.result} />
              </Text>
            );
          })
        ) : (
          <Text dimColor>(waiting for messages...)</Text>
        )}
        {sessionRunning && <Spinner label="Thinking..." />}
      </Box>

      <Text dimColor>{"─".repeat(cols)}</Text>

      <Box paddingLeft={1}>
        <Text color="magenta" bold>
          {"❯ "}
        </Text>
        <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
      </Box>

      <Box paddingLeft={1}>
        <Text dimColor>
          {"cc-cli "}
          <Text color={statusColor(status)}>{statusText(status)}</Text>
          {" | "}
          {displayPath}
        </Text>
      </Box>
    </Box>
  );
}
