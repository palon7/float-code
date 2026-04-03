import type { ParsedEntry } from "@palon7/cc-client";

const VALID_KINDS = new Set([
  "system",
  "thinking",
  "text",
  "tool_call",
  "tool_result",
  "user_message",
  "result",
  "notification",
]);

export function isParsedEntry(v: unknown): v is ParsedEntry {
  return (
    typeof v === "object" &&
    v !== null &&
    "kind" in v &&
    typeof (v as { kind: unknown }).kind === "string" &&
    VALID_KINDS.has((v as { kind: string }).kind)
  );
}
