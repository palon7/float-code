import { describe, it, expect } from "vitest";
import { EntryBuffer } from "./entry-buffer.js";
import type {
  TextEntry,
  ThinkingEntry,
  ToolCallEntry,
} from "@palon7/cc-client";

function makeText(id: string, text: string, isStreaming: boolean): TextEntry {
  return {
    id,
    kind: "text",
    text,
    isStreaming,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

function makeThinking(
  id: string,
  text: string,
  isStreaming: boolean,
): ThinkingEntry {
  return {
    id,
    kind: "thinking",
    text,
    isStreaming,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

function makeToolCall(id: string, isStreaming?: boolean): ToolCallEntry {
  return {
    id,
    kind: "tool_call",
    toolName: "Bash",
    toolUseId: id,
    input: { command: "ls" },
    isStreaming,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

describe("EntryBuffer", () => {
  it("add / getAll / size", () => {
    const buf = new EntryBuffer();
    const e = makeText("a", "hello", false);
    buf.add(e);
    expect(buf.size).toBe(1);
    expect(buf.getAll()).toEqual([e]);
  });

  it("getAll returns a copy", () => {
    const buf = new EntryBuffer();
    buf.add(makeText("a", "x", false));
    const copy = buf.getAll();
    copy.push(makeText("b", "y", false));
    expect(buf.size).toBe(1);
  });

  it("maxEntries: 超過時に古いエントリを削除", () => {
    const buf = new EntryBuffer(3);
    buf.add(makeText("a", "1", false));
    buf.add(makeText("b", "2", false));
    buf.add(makeText("c", "3", false));
    buf.add(makeText("d", "4", false));
    expect(buf.size).toBe(3);
    expect(buf.getAll().map((e) => e.id)).toEqual(["b", "c", "d"]);
  });

  it("バイト上限超過時に古いエントリを削除", () => {
    const buf = new EntryBuffer(1000); // 件数上限は十分大きく
    const bigText = "x".repeat(800_000);
    buf.add(makeText("a", bigText, false));
    buf.add(makeText("b", bigText, false));
    // 2件で ~1.6MB > 1.5MB → 1件目が削除される
    expect(buf.size).toBe(1);
    expect(buf.getAll()[0]?.id).toBe("b");
  });

  describe("appendTextDelta", () => {
    it("既知 id に delta を蓄積して更新済みエントリを返す", () => {
      const buf = new EntryBuffer();
      buf.add(makeText("x", "hello", true));
      const result = buf.appendTextDelta("x", " world") as TextEntry;
      expect(result.text).toBe("hello world");
      expect((buf.getAll()[0] as TextEntry).text).toBe("hello world");
    });

    it("ThinkingEntry にも蓄積できる", () => {
      const buf = new EntryBuffer();
      buf.add(makeThinking("y", "think", true));
      const result = buf.appendTextDelta("y", "ing") as ThinkingEntry;
      expect(result.text).toBe("thinking");
    });

    it("未知 id で null を返す", () => {
      const buf = new EntryBuffer();
      expect(buf.appendTextDelta("unknown", "delta")).toBeNull();
    });
  });

  describe("replaceEntry", () => {
    it("同一 id のエントリを置き換えて true を返す", () => {
      const buf = new EntryBuffer();
      buf.add(makeToolCall("tc1", true));
      const updated = makeToolCall("tc1", true);
      (updated.input as Record<string, unknown>).command = "pwd";
      expect(buf.replaceEntry("tc1", updated)).toBe(true);
      expect((buf.getAll()[0] as ToolCallEntry).input.command).toBe("pwd");
    });

    it("未知 id で false を返す（add されない）", () => {
      const buf = new EntryBuffer();
      expect(buf.replaceEntry("none", makeToolCall("none", true))).toBe(false);
      expect(buf.size).toBe(0);
    });
  });

  describe("clearStreaming", () => {
    it("isStreaming=true のエントリのみ除去", () => {
      const buf = new EntryBuffer();
      buf.add(makeText("a", "final", false));
      buf.add(makeText("b", "stream", true));
      buf.add(makeToolCall("c", true));
      buf.clearStreaming();
      expect(buf.size).toBe(1);
      expect(buf.getAll()[0]?.id).toBe("a");
    });

    it("streaming がなければ何も変わらない", () => {
      const buf = new EntryBuffer();
      buf.add(makeText("a", "x", false));
      buf.clearStreaming();
      expect(buf.size).toBe(1);
    });
  });

  describe("hasStreamingEntries", () => {
    it("streaming エントリがある場合 true", () => {
      const buf = new EntryBuffer();
      buf.add(makeText("a", "x", true));
      expect(buf.hasStreamingEntries()).toBe(true);
    });

    it("streaming エントリがない場合 false", () => {
      const buf = new EntryBuffer();
      buf.add(makeText("a", "x", false));
      expect(buf.hasStreamingEntries()).toBe(false);
    });

    it("空バッファで false", () => {
      expect(new EntryBuffer().hasStreamingEntries()).toBe(false);
    });
  });
});
