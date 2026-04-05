import type { SessionStatus } from "@float-code/shared/protocol";
import type { ParsedEntry, ToolResultEntry } from "@palon7/cc-client";

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

export function formatToolName(toolName: string): string {
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    return `${parts[1]}:${parts.slice(2).join(":")}`;
  }
  return toolName;
}

export function getPrimaryParam(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const keys = PRIMARY_PARAM_KEYS[toolName.toLowerCase()];
  const raw = keys
    ? keys.reduce<unknown>((v, k) => v ?? input[k], undefined)
    : Object.values(input)[0];
  if (raw == null) return "";
  const s = String(raw).replaceAll("\n", " ");
  return s.length > 60 ? s.slice(0, 57) + "..." : s;
}

export function entryToText(
  entry: ParsedEntry,
  result?: ToolResultEntry,
): string {
  const text = "text" in entry ? entry.text.replace(/`/g, "'") : "";

  switch (entry.kind) {
    case "system":
      return `● Session started (${entry.model})`;
    case "user_message":
      return `\n▶ ${text}`;
    case "thinking":
      if (!text) return "";
      return `◌ ${text}`;
    case "text":
      return text;
    case "tool_call": {
      const name = formatToolName(entry.toolName);
      const param = getPrimaryParam(entry.toolName, entry.input);
      let line = `● ${name}`;
      if (param) line += ` ${param}`;
      if (result) {
        const flat = result.content.replaceAll("\n", " ");
        const content = flat.length > 80 ? flat.slice(0, 77) + "..." : flat;
        line += `\n  └ ${content}`;
      }
      return line;
    }
    case "result": {
      if (entry.isError) return "✗ Error";
      return `✓ Done (${entry.numTurns} turns, $${entry.totalCostUsd.toFixed(4)}, ${(entry.durationMs / 1000).toFixed(1)}s)`;
    }
    case "notification":
      return entry.text;
    default:
      return "";
  }
}

export interface LogLine {
  id: string;
  entry: ParsedEntry;
  result?: ToolResultEntry;
}

export type StatusIcon =
  | "idle"
  | "spawning"
  | "running"
  | "thinking"
  | "tool_call"
  | "permission";

export interface StatusInfo {
  icon: StatusIcon;
  text: string;
}

export function getStatusInfo(
  sessionStatus: SessionStatus | "none",
  lines: readonly LogLine[],
): StatusInfo {
  switch (sessionStatus) {
    case "none":
      return { icon: "idle", text: "No session" };
    case "idle":
      return { icon: "idle", text: "Ready" };
    case "spawning":
      return { icon: "spawning", text: "Starting..." };
    case "running": {
      const last = lines[lines.length - 1];
      if (last) {
        const e = last.entry;
        if (e.kind === "thinking")
          return { icon: "thinking", text: "Thinking..." };
        if (e.kind === "tool_call")
          return {
            icon: "tool_call",
            text: `${formatToolName(e.toolName)}: ${getPrimaryParam(e.toolName, e.input)}`,
          };
        if (e.kind === "text")
          return { icon: "running", text: "Responding..." };
      }
      return { icon: "running", text: "Running..." };
    }
    case "waiting_permission":
      return { icon: "permission", text: "Permission required" };
  }
}

const STATUS_ICONS: Record<StatusIcon, string> = {
  idle: "○",
  spawning: "◇",
  running: "▶",
  thinking: "◌",
  tool_call: "●",
  permission: "▲",
};

export function getStatusText(
  sessionStatus: SessionStatus | "none",
  lines: readonly LogLine[],
): string {
  const info = getStatusInfo(sessionStatus, lines);
  return `${STATUS_ICONS[info.icon]} ${info.text}`;
}

export function getLogText(lines: readonly LogLine[]): string {
  return lines.map((l) => entryToText(l.entry, l.result)).join("\n");
}

export function getSimpleModeLogText(lines: readonly LogLine[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = lines[i].entry;
    if (entry.kind === "user_message") return " ";
    if (entry.kind !== "text") continue;
    const text = entry.text.trim();
    if (text) return text;
  }
  return "";
}
