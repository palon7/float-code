import { describe, expect, it } from "vitest";
import type { LogLine } from "./session-format";
import { getSimpleModeLogText } from "./session-format";
import type { ParsedEntry } from "@palon7/cc-client";

function line(entry: ParsedEntry): LogLine {
  return { id: entry.kind + Math.random(), entry };
}

describe("getSimpleModeLogText", () => {
  it("returns empty string when lines is empty", () => {
    expect(getSimpleModeLogText([])).toBe("");
  });

  it("returns the last text entry", () => {
    const lines = [
      line({ kind: "text", text: "first" } as ParsedEntry),
      line({ kind: "text", text: "second" } as ParsedEntry),
    ];
    expect(getSimpleModeLogText(lines)).toBe("second");
  });

  it("skips tool_call, thinking, and result entries", () => {
    const lines = [
      line({ kind: "text", text: "answer" } as ParsedEntry),
      line({
        kind: "thinking",
        text: "hmm",
      } as ParsedEntry),
      line({
        kind: "tool_call",
        toolName: "read",
        toolUseId: "1",
        input: {},
      } as ParsedEntry),
      line({
        kind: "result",
        isError: false,
        numTurns: 1,
        totalCostUsd: 0,
        durationMs: 100,
      } as ParsedEntry),
    ];
    expect(getSimpleModeLogText(lines)).toBe("answer");
  });

  it("skips text entries that are whitespace-only", () => {
    const lines = [
      line({ kind: "text", text: "real content" } as ParsedEntry),
      line({ kind: "text", text: "   \n  " } as ParsedEntry),
    ];
    expect(getSimpleModeLogText(lines)).toBe("real content");
  });

  it("returns empty string when no text entries exist", () => {
    const lines = [
      line({
        kind: "tool_call",
        toolName: "bash",
        toolUseId: "1",
        input: {},
      } as ParsedEntry),
      line({
        kind: "thinking",
        text: "thinking...",
      } as ParsedEntry),
    ];
    expect(getSimpleModeLogText(lines)).toBe("");
  });

  it("returns trimmed text", () => {
    const lines = [
      line({ kind: "text", text: "  hello world  " } as ParsedEntry),
    ];
    expect(getSimpleModeLogText(lines)).toBe("hello world");
  });

  it("returns a single space when user_message is the latest boundary", () => {
    const lines = [
      line({ kind: "text", text: "old answer" } as ParsedEntry),
      line({ kind: "user_message", text: "new question" } as ParsedEntry),
    ];
    expect(getSimpleModeLogText(lines)).toBe(" ");
  });

  it("returns text after user_message", () => {
    const lines = [
      line({ kind: "text", text: "old answer" } as ParsedEntry),
      line({ kind: "user_message", text: "new question" } as ParsedEntry),
      line({ kind: "thinking", text: "hmm" } as ParsedEntry),
      line({ kind: "text", text: "new answer" } as ParsedEntry),
    ];
    expect(getSimpleModeLogText(lines)).toBe("new answer");
  });
});
